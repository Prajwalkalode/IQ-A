import base64
import gzip
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import boto3
import dynamodb_data
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.stub import Stubber


class DynamoDbDataTests(unittest.TestCase):
    def test_binary_and_set_values_round_trip(self):
        serializer = TypeSerializer()
        deserializer = TypeDeserializer()
        original = {
            "blob": b"\x00\x01\xff",
            "binarySet": {b"two", b"one"},
            "stringSet": {"b", "a"},
            "nested": {"blob": b"nested"},
        }
        attribute_values = {
            name: serializer.serialize(value)
            for name, value in original.items()
        }

        encoded = dynamodb_data.encode_item(attribute_values)
        decoded = dynamodb_data.decode_item(encoded)

        self.assertEqual(decoded["blob"], deserializer.deserialize(attribute_values["blob"]))
        self.assertEqual(decoded["binarySet"], deserializer.deserialize(attribute_values["binarySet"]))
        self.assertEqual(decoded["stringSet"], deserializer.deserialize(attribute_values["stringSet"]))
        self.assertEqual(decoded["nested"], deserializer.deserialize(attribute_values["nested"]))
        self.assertEqual(encoded["blob"]["B"], base64.b64encode(original["blob"]).decode("ascii"))
        decoded_attributes = {
            name: dynamodb_data._decode_attribute_value(attribute_value)
            for name, attribute_value in encoded.items()
        }
        self.assertEqual(
            set(decoded_attributes["binarySet"]["BS"]),
            deserializer.deserialize(attribute_values["binarySet"]),
        )
        self.assertEqual(
            set(decoded_attributes["stringSet"]["SS"]),
            deserializer.deserialize(attribute_values["stringSet"]),
        )
        self.assertIsInstance(decoded_attributes["binarySet"]["BS"], list)
        self.assertIsInstance(decoded_attributes["stringSet"]["SS"], list)

    def test_snapshot_id_rejects_path_components(self):
        with self.assertRaises(ValueError):
            dynamodb_data.validate_snapshot_id("../manifest")

    def test_scan_table_paginates_with_consistent_reads(self):
        dynamodb = Mock()
        dynamodb.scan.side_effect = [
            {
                "Items": [{"id": {"S": "one"}}],
                "LastEvaluatedKey": {"id": {"S": "one"}},
            },
            {"Items": [{"id": {"S": "two"}}]},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.jsonl.gz"
            item_count = dynamodb_data._scan_table(dynamodb, "table", path)
            with gzip.open(path, "rt", encoding="utf-8") as snapshot:
                items = [json.loads(line) for line in snapshot]

        self.assertEqual(item_count, 2)
        self.assertEqual(items, [{"id": {"S": "one"}}, {"id": {"S": "two"}}])
        self.assertTrue(dynamodb.scan.call_args_list[0].kwargs["ConsistentRead"])
        self.assertEqual(
            dynamodb.scan.call_args_list[1].kwargs["ExclusiveStartKey"],
            {"id": {"S": "one"}},
        )

    def test_manifest_rejects_unexpected_object_key(self):
        snapshot_id = "20261125T120000Z-123-1"
        tables = {}
        for logical_name in dynamodb_data.TABLE_ENV:
            tables[logical_name] = {
                "objectKey": dynamodb_data.object_key(
                    snapshot_id,
                    f"{logical_name}.jsonl.gz",
                ),
                "itemCount": 0,
                "sha256": "0" * 64,
                "keySchema": [{"AttributeName": "id", "KeyType": "HASH"}],
                "keyTypes": {"id": "S"},
            }
        tables["users"]["objectKey"] = "snapshots/other/users.jsonl.gz"
        manifest = {
            "formatVersion": dynamodb_data.FORMAT_VERSION,
            "snapshotId": snapshot_id,
            "tables": tables,
        }

        with self.assertRaisesRegex(ValueError, "invalid object key"):
            dynamodb_data._validate_manifest(manifest, snapshot_id)

    def test_batch_write_retries_unprocessed_items(self):
        dynamodb = Mock()
        requests = [{"PutRequest": {"Item": {"id": {"S": "one"}}}}]
        dynamodb.batch_write_item.side_effect = [
            {"UnprocessedItems": {"table": requests}},
            {"UnprocessedItems": {}},
        ]

        with patch.object(dynamodb_data.time, "sleep") as sleep:
            dynamodb_data._write_batch(
                dynamodb,
                "table",
                [{"id": {"S": "one"}}],
            )

        self.assertEqual(dynamodb.batch_write_item.call_count, 2)
        dynamodb.batch_write_item.assert_called_with(
            RequestItems={
                "table": [
                    {"PutRequest": {"Item": {"id": {"S": "one"}}}},
                ]
            }
        )
        sleep.assert_called_once_with(1)

    def test_batch_write_fails_after_retry_limit(self):
        dynamodb = Mock()
        requests = [{"PutRequest": {"Item": {"id": {"S": "one"}}}}]
        dynamodb.batch_write_item.return_value = {
            "UnprocessedItems": {"table": requests}
        }

        with patch.object(dynamodb_data.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "restore is incomplete"):
                dynamodb_data._write_batch(
                    dynamodb,
                    "table",
                    [{"id": {"S": "one"}}],
                )

        self.assertEqual(
            dynamodb.batch_write_item.call_count,
            dynamodb_data.MAX_UNPROCESSED_RETRIES + 1,
        )

    def test_batch_write_uses_valid_dynamodb_attribute_values(self):
        dynamodb = boto3.client(
            "dynamodb",
            region_name="ap-south-1",
            aws_access_key_id="test",
            aws_secret_access_key="test",
        )
        item = {
            "id": {"S": "one"},
            "binary": {"B": b"\x00\xff"},
            "strings": {"SS": ["a", "b"]},
            "binarySet": {"BS": [b"\x01", b"\x02"]},
        }
        expected = {
            "RequestItems": {
                "table": [{"PutRequest": {"Item": item}}],
            }
        }
        with Stubber(dynamodb) as stubber:
            stubber.add_response(
                "batch_write_item",
                {"UnprocessedItems": {}},
                expected,
            )
            dynamodb_data._write_batch(dynamodb, "table", [item])

    def test_preserve_and_reseed_round_trip_without_aws_credentials(self):
        class FakeDynamoDb:
            def __init__(self):
                self.writes = []

            def describe_table(self, TableName):
                return {
                    "Table": {
                        "TableStatus": "ACTIVE",
                        "KeySchema": [
                            {"AttributeName": "id", "KeyType": "HASH"},
                        ],
                        "AttributeDefinitions": [
                            {"AttributeName": "id", "AttributeType": "S"},
                        ],
                    }
                }

            def scan(self, TableName, **kwargs):
                return {
                    "Items": [
                        {
                            "id": {"S": TableName},
                            "payload": {"B": b"\x00\xff"},
                        }
                    ]
                }

            def batch_write_item(self, RequestItems):
                self.writes.append(RequestItems)
                return {"UnprocessedItems": {}}

        class FakeS3:
            def __init__(self):
                self.objects = {}

            def upload_file(self, filename, bucket, key, ExtraArgs):
                self.assert_encrypted(ExtraArgs)
                self.objects[key] = Path(filename).read_bytes()

            def download_file(self, bucket, key, filename):
                Path(filename).write_bytes(self.objects[key])

            def put_object(self, Bucket, Key, Body, **kwargs):
                self.objects[Key] = Body

            def get_object(self, Bucket, Key):
                return {"Body": io.BytesIO(self.objects[Key])}

            def assert_encrypted(self, extra_args):
                if extra_args.get("ServerSideEncryption") != "AES256":
                    raise AssertionError("Snapshot object was not encrypted.")

        dynamodb = FakeDynamoDb()
        s3 = FakeS3()
        table_names = {
            logical_name: f"{logical_name}-table"
            for logical_name in dynamodb_data.TABLE_ENV
        }
        snapshot_id = "20261125T120000Z-123-1"
        with patch.object(
            dynamodb_data.boto3,
            "client",
            side_effect=lambda service, region_name: {
                "dynamodb": dynamodb,
                "s3": s3,
            }[service],
        ):
            dynamodb_data.preserve_data(
                snapshot_id,
                "backup-bucket",
                "ap-south-1",
                table_names,
            )
            dynamodb_data.reseed_data(
                snapshot_id,
                "backup-bucket",
                "ap-south-1",
                table_names,
            )

        self.assertEqual(len(dynamodb.writes), len(dynamodb_data.TABLE_ENV))
        writes_by_table = {
            next(iter(requests)): requests
            for requests in dynamodb.writes
        }
        for logical_name, table_name in table_names.items():
            item = writes_by_table[table_name][table_name][0]["PutRequest"]["Item"]
            self.assertEqual(item["id"], {"S": table_name})
            self.assertEqual(item["payload"], {"B": b"\x00\xff"})
        self.assertIn(
            dynamodb_data.object_key(snapshot_id, "manifest.json"),
            s3.objects,
        )


if __name__ == "__main__":
    unittest.main()
