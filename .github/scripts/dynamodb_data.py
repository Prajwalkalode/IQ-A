import argparse
import base64
import binascii
import gzip
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
from boto3.exceptions import Boto3Error
from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import BotoCoreError, ClientError


TABLE_ENV = {
    "users": "USERS_TABLE",
    "questions": "QUESTIONS_TABLE",
    "quiz_sessions": "QUIZ_SESSIONS_TABLE",
    "quiz_assignments": "QUIZ_ASSIGNMENTS_TABLE",
    "submissions": "SUBMISSIONS_TABLE",
}
SNAPSHOT_ID_PATTERN = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9]+$")
SNAPSHOT_PREFIX = "snapshots"
SNAPSHOT_MANIFEST_KEY_PATTERN = re.compile(
    rf"^{SNAPSHOT_PREFIX}/([0-9]{{8}}T[0-9]{{6}}Z-[0-9]+-[0-9]+)/manifest\.json$"
)
FORMAT_VERSION = 1
MAX_BATCH_SIZE = 25
MAX_UNPROCESSED_RETRIES = 8
DESERIALIZER = TypeDeserializer()


def object_key(snapshot_id, filename):
    return f"{SNAPSHOT_PREFIX}/{snapshot_id}/{filename}"


def validate_snapshot_id(snapshot_id):
    if not SNAPSHOT_ID_PATTERN.fullmatch(snapshot_id):
        raise ValueError(
            "Snapshot ID must use the format YYYYmmddTHHMMSSZ-run_id-run_attempt."
        )


def table_names_from_env():
    names = {}
    for logical_name, env_name in TABLE_ENV.items():
        table_name = os.environ.get(env_name, "")
        if not table_name or len(table_name) > 255:
            raise ValueError(f"Missing or invalid table name in {env_name}.")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", table_name):
            raise ValueError(f"Invalid table name in {env_name}.")
        names[logical_name] = table_name
    return names


def _encode_attribute_value(attribute_value):
    if not isinstance(attribute_value, dict) or len(attribute_value) != 1:
        raise ValueError("Invalid DynamoDB attribute value.")

    kind, value = next(iter(attribute_value.items()))
    if kind == "B":
        return {kind: base64.b64encode(bytes(value)).decode("ascii")}
    if kind == "BS":
        encoded = [base64.b64encode(bytes(item)).decode("ascii") for item in value]
        return {kind: sorted(encoded)}
    if kind in ("SS", "NS"):
        return {kind: sorted(value)}
    if kind == "M":
        return {kind: {key: _encode_attribute_value(item) for key, item in value.items()}}
    if kind == "L":
        return {kind: [_encode_attribute_value(item) for item in value]}
    return {kind: value}


def _decode_attribute_value(attribute_value):
    if not isinstance(attribute_value, dict) or len(attribute_value) != 1:
        raise ValueError("Invalid DynamoDB attribute value.")

    kind, value = next(iter(attribute_value.items()))
    if kind == "B":
        return {kind: base64.b64decode(value, validate=True)}
    if kind == "BS":
        return {kind: [base64.b64decode(item, validate=True) for item in value]}
    if kind in ("SS", "NS"):
        return {kind: value}
    if kind == "M":
        return {kind: {key: _decode_attribute_value(item) for key, item in value.items()}}
    if kind == "L":
        return {kind: [_decode_attribute_value(item) for item in value]}
    return {kind: value}


def encode_item(item):
    return {
        name: _encode_attribute_value(attribute_value)
        for name, attribute_value in item.items()
    }


def decode_item(item):
    try:
        return {
            name: DESERIALIZER.deserialize(_decode_attribute_value(attribute_value))
            for name, attribute_value in item.items()
        }
    except (binascii.Error, KeyError, TypeError, ValueError) as error:
        raise ValueError("Snapshot contains an invalid DynamoDB item.") from error


def table_metadata(dynamodb, table_name):
    description = dynamodb.describe_table(TableName=table_name)["Table"]
    if description["TableStatus"] != "ACTIVE":
        raise RuntimeError(f"DynamoDB table {table_name} is not ACTIVE.")

    key_schema = sorted(
        description["KeySchema"],
        key=lambda item: item["AttributeName"],
    )
    key_names = {item["AttributeName"] for item in key_schema}
    key_types = {
        item["AttributeName"]: item["AttributeType"]
        for item in description["AttributeDefinitions"]
        if item["AttributeName"] in key_names
    }
    if set(key_types) != key_names:
        raise RuntimeError(f"Could not read the primary key schema for {table_name}.")
    return {"keySchema": key_schema, "keyTypes": key_types}


def _validate_item_keys(item, metadata):
    for key_name, expected_type in metadata["keyTypes"].items():
        key_value = item.get(key_name)
        if not isinstance(key_value, dict) or len(key_value) != 1:
            raise ValueError("Snapshot item is missing a primary key.")
        if next(iter(key_value)) != expected_type:
            raise ValueError("Snapshot item has a primary key with the wrong type.")


def _read_snapshot_lines(path, metadata):
    with gzip.open(path, "rt", encoding="utf-8") as snapshot:
        for line in snapshot:
            if not line.strip():
                raise ValueError("Snapshot contains an empty item record.")
            try:
                item = json.loads(line)
                if not isinstance(item, dict):
                    raise ValueError
                _validate_item_keys(item, metadata)
                decoded_item = decode_item(item)
            except (json.JSONDecodeError, TypeError, ValueError) as error:
                raise ValueError("Snapshot contains an invalid item record.") from error
            yield item, decoded_item


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _scan_table(dynamodb, table_name, path):
    count = 0
    request = {"TableName": table_name, "ConsistentRead": True}
    with open(path, "wb") as raw_file:
        with gzip.GzipFile(fileobj=raw_file, mode="wb", mtime=0) as compressed:
            while True:
                page = dynamodb.scan(**request)
                for item in page.get("Items", []):
                    encoded = json.dumps(
                        encode_item(item),
                        separators=(",", ":"),
                        sort_keys=True,
                        allow_nan=False,
                    )
                    compressed.write((encoded + "\n").encode("utf-8"))
                    count += 1

                last_key = page.get("LastEvaluatedKey")
                if not last_key:
                    break
                request["ExclusiveStartKey"] = last_key
    return count


def _verify_snapshot_file(path, expected_count, expected_hash, metadata):
    if _sha256_file(path) != expected_hash:
        raise ValueError("Snapshot file checksum does not match its manifest.")
    count = sum(1 for _ in _read_snapshot_lines(path, metadata))
    if count != expected_count:
        raise ValueError("Snapshot item count does not match its manifest.")


def _manifest_for_snapshot(s3, bucket, snapshot_id):
    key = object_key(snapshot_id, "manifest.json")
    try:
        response = s3.get_object(Bucket=bucket, Key=key)
        body = response["Body"]
        try:
            manifest_body = body.read()
        finally:
            body.close()
        return json.loads(manifest_body)
    except (ClientError, BotoCoreError) as error:
        raise RuntimeError(
            f"Could not read snapshot manifest at s3://{bucket}/{key}."
        ) from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("Snapshot manifest is not valid JSON.") from error


def _latest_snapshot_id(s3, bucket):
    paginator = s3.get_paginator("list_objects_v2")
    latest_snapshot = None
    latest_modified = None

    for page in paginator.paginate(
        Bucket=bucket,
        Prefix=f"{SNAPSHOT_PREFIX}/",
    ):
        for item in page.get("Contents", []):
            key = item.get("Key", "")
            match = SNAPSHOT_MANIFEST_KEY_PATTERN.fullmatch(key)
            if not match:
                continue
            modified = item.get("LastModified")
            if modified is None:
                continue
            if latest_modified is None or modified > latest_modified:
                latest_snapshot = match.group(1)
                latest_modified = modified

    if latest_snapshot is None:
        raise ValueError(f"No completed snapshots were found in s3://{bucket}/.")
    return latest_snapshot


def _validate_manifest(manifest, snapshot_id):
    if not isinstance(manifest, dict):
        raise ValueError("Snapshot manifest has an invalid structure.")
    if manifest.get("formatVersion") != FORMAT_VERSION:
        raise ValueError("Snapshot format version is not supported.")
    if manifest.get("snapshotId") != snapshot_id:
        raise ValueError("Snapshot manifest ID does not match the requested ID.")

    tables = manifest.get("tables")
    if not isinstance(tables, dict) or set(tables) != set(TABLE_ENV):
        raise ValueError("Snapshot manifest does not contain the expected tables.")

    for logical_name, table_info in tables.items():
        if not isinstance(table_info, dict):
            raise ValueError("Snapshot manifest has invalid table metadata.")
        if table_info.get("objectKey") != object_key(
            snapshot_id, f"{logical_name}.jsonl.gz"
        ):
            raise ValueError("Snapshot manifest contains an invalid object key.")
        count = table_info.get("itemCount")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError("Snapshot manifest contains an invalid item count.")
        if not re.fullmatch(r"[0-9a-f]{64}", table_info.get("sha256", "")):
            raise ValueError("Snapshot manifest contains an invalid checksum.")
        if not isinstance(table_info.get("keySchema"), list) or not isinstance(
            table_info.get("keyTypes"), dict
        ):
            raise ValueError("Snapshot manifest has invalid key schema metadata.")
    return tables


def _summary(snapshot_id, bucket, tables, action):
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    lines = [
        f"## DynamoDB {action} complete",
        "",
        f"- Snapshot ID: `{snapshot_id}`",
        f"- S3 location: `s3://{bucket}/{SNAPSHOT_PREFIX}/{snapshot_id}/`",
        "",
        "| Table | Items |",
        "| --- | ---: |",
    ]
    lines.extend(
        f"| `{logical_name}` | {table_info['itemCount']} |"
        for logical_name, table_info in tables.items()
    )
    with open(summary_path, "a", encoding="utf-8") as summary_file:
        summary_file.write("\n".join(lines) + "\n")


def preserve_data(snapshot_id, bucket, region, table_names):
    validate_snapshot_id(snapshot_id)
    if not bucket:
        raise ValueError("Set the DYNAMODB_BACKUP_BUCKET repository variable.")

    dynamodb = boto3.client("dynamodb", region_name=region)
    s3 = boto3.client("s3", region_name=region)
    with tempfile.TemporaryDirectory(prefix="iqa-backup-") as directory:
        temp_dir = Path(directory)
        table_manifest = {}

        for logical_name, table_name in table_names.items():
            metadata = table_metadata(dynamodb, table_name)
            file_path = temp_dir / f"{logical_name}.jsonl.gz"
            item_count = _scan_table(dynamodb, table_name, file_path)
            checksum = _sha256_file(file_path)
            key = object_key(snapshot_id, file_path.name)

            s3.upload_file(
                str(file_path),
                bucket,
                key,
                ExtraArgs={
                    "ContentType": "application/gzip",
                    "ServerSideEncryption": "AES256",
                },
            )
            downloaded_path = temp_dir / f"verify-{file_path.name}"
            s3.download_file(bucket, key, str(downloaded_path))
            _verify_snapshot_file(
                downloaded_path,
                item_count,
                checksum,
                metadata,
            )

            table_manifest[logical_name] = {
                "tableName": table_name,
                "objectKey": key,
                "itemCount": item_count,
                "sha256": checksum,
                **metadata,
            }
            print(f"Backed up {item_count} items from {logical_name}.")

        manifest = {
            "formatVersion": FORMAT_VERSION,
            "snapshotId": snapshot_id,
            "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "region": region,
            "tables": table_manifest,
        }
        manifest_key = object_key(snapshot_id, "manifest.json")
        manifest_body = json.dumps(
            manifest,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        s3.put_object(
            Bucket=bucket,
            Key=manifest_key,
            Body=manifest_body,
            ContentType="application/json",
            ServerSideEncryption="AES256",
        )
        uploaded_manifest = _manifest_for_snapshot(s3, bucket, snapshot_id)
        if uploaded_manifest != manifest:
            raise RuntimeError("Uploaded snapshot manifest did not verify.")

    print(f"Verified snapshot {snapshot_id} in s3://{bucket}/{SNAPSHOT_PREFIX}/.")
    _summary(snapshot_id, bucket, table_manifest, "backup")


def _wait_for_active_table(dynamodb, table_name):
    deadline = time.monotonic() + 600
    while True:
        description = dynamodb.describe_table(TableName=table_name)["Table"]
        status = description["TableStatus"]
        if status == "ACTIVE":
            return
        if time.monotonic() >= deadline:
            raise RuntimeError(f"DynamoDB table {table_name} did not become ACTIVE.")
        time.sleep(5)


def _write_batch(dynamodb, table_name, items):
    requests = [
        {"PutRequest": {"Item": item}}
        for item in items
    ]
    attempt = 0
    while requests:
        response = dynamodb.batch_write_item(RequestItems={table_name: requests})
        requests = response.get("UnprocessedItems", {}).get(table_name, [])
        if not requests:
            return
        if attempt >= MAX_UNPROCESSED_RETRIES:
            raise RuntimeError(
                f"DynamoDB left items unprocessed in table {table_name}; restore is incomplete."
            )
        time.sleep(min(2**attempt, 30))
        attempt += 1


def reseed_data(snapshot_id, bucket, region, table_names):
    if not bucket:
        raise ValueError("Set the DYNAMODB_BACKUP_BUCKET repository variable.")

    s3 = boto3.client("s3", region_name=region)
    if snapshot_id == "latest":
        snapshot_id = _latest_snapshot_id(s3, bucket)
        print(f"Selected latest completed snapshot: {snapshot_id}")
    validate_snapshot_id(snapshot_id)

    dynamodb = boto3.client("dynamodb", region_name=region)
    manifest = _manifest_for_snapshot(s3, bucket, snapshot_id)
    manifest_tables = _validate_manifest(manifest, snapshot_id)

    target_metadata = {}
    for logical_name, table_name in table_names.items():
        _wait_for_active_table(dynamodb, table_name)
        metadata = table_metadata(dynamodb, table_name)
        saved = manifest_tables[logical_name]
        if (
            metadata["keySchema"] != saved["keySchema"]
            or metadata["keyTypes"] != saved["keyTypes"]
        ):
            raise ValueError(
                f"Primary key schema for {logical_name} does not match the snapshot."
            )
        target_metadata[logical_name] = metadata

    with tempfile.TemporaryDirectory(prefix="iqa-restore-") as directory:
        temp_dir = Path(directory)
        snapshot_files = {}
        for logical_name, table_info in manifest_tables.items():
            file_path = temp_dir / f"{logical_name}.jsonl.gz"
            s3.download_file(bucket, table_info["objectKey"], str(file_path))
            _verify_snapshot_file(
                file_path,
                table_info["itemCount"],
                table_info["sha256"],
                target_metadata[logical_name],
            )
            snapshot_files[logical_name] = file_path

        for logical_name, file_path in snapshot_files.items():
            table_name = table_names[logical_name]
            batch = []
            restored_count = 0
            for encoded_item, _ in _read_snapshot_lines(
                file_path,
                target_metadata[logical_name],
            ):
                batch.append(
                    {
                        name: _decode_attribute_value(attribute_value)
                        for name, attribute_value in encoded_item.items()
                    }
                )
                if len(batch) == MAX_BATCH_SIZE:
                    _write_batch(dynamodb, table_name, batch)
                    restored_count += len(batch)
                    batch = []
            if batch:
                _write_batch(dynamodb, table_name, batch)
                restored_count += len(batch)
            print(f"Restored {restored_count} items into {logical_name}.")

    _summary(snapshot_id, bucket, manifest_tables, "restore")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("preserve", "reseed"))
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--writes-paused", action="store_true")
    args = parser.parse_args()

    if args.action == "preserve" and not args.writes_paused:
        parser.error("Pass --writes-paused only after pausing application writes.")

    region = os.environ.get("AWS_REGION", "")
    if not region:
        parser.error("AWS_REGION must be set.")

    try:
        table_names = table_names_from_env()
        bucket = os.environ.get("DYNAMODB_BACKUP_BUCKET", "")
        if args.action == "preserve":
            preserve_data(args.snapshot_id, bucket, region, table_names)
        else:
            reseed_data(args.snapshot_id, bucket, region, table_names)
    except (
        Boto3Error,
        BotoCoreError,
        ClientError,
        OSError,
        RuntimeError,
        ValueError,
    ) as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
