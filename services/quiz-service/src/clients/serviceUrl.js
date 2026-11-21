const { GetParameterCommand, SSMClient } = require('@aws-sdk/client-ssm');

const ssmClient = new SSMClient({});
const cachedUrls = new Map();

function normalizeUrl(value, errorClass, settingName) {
	try {
		const parsedUrl = new URL(value);
		if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
			throw new TypeError('Unsupported URL protocol');
		}
		return value.trim().replace(/\/+$/, '');
	} catch (error) {
		throw new errorClass(`${settingName} is not a valid service URL`, error);
	}
}

async function resolveServiceUrl(urlSetting, parameterSetting, errorClass) {
	const configuredUrl = process.env[urlSetting];
	if (configuredUrl) {
		return normalizeUrl(configuredUrl, errorClass, urlSetting);
	}

	const parameterName = process.env[parameterSetting];
	if (!parameterName) {
		throw new errorClass(`${urlSetting} is not configured`);
	}

	let cachedUrl = cachedUrls.get(parameterName);
	if (!cachedUrl) {
		cachedUrl = ssmClient
			.send(new GetParameterCommand({ Name: parameterName }))
			.then(({ Parameter }) => {
				if (!Parameter || !Parameter.Value) {
					throw new errorClass(`${parameterSetting} did not resolve to a URL`);
				}
				return normalizeUrl(Parameter.Value, errorClass, parameterSetting);
			})
			.catch((error) => {
				cachedUrls.delete(parameterName);
				if (error instanceof errorClass) {
					throw error;
				}
				throw new errorClass(`Unable to load ${urlSetting} from SSM`, error);
			});
		cachedUrls.set(parameterName, cachedUrl);
	}

	return cachedUrl;
}

module.exports = { resolveServiceUrl };
