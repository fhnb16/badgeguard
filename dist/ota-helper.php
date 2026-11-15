<?php
declare(strict_types=1);

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const OTA_RSA_PUBLIC_KEY_B64 = 'MIHNMA0GCSqGSIb3DQEBAQUAA4G7ADCBtwKBrwzT77v1XOcdhRNpxIwnItPNSWwrioUnfJX+kMw8Jdke/OJMoiwDNfsyS0ZIkhstIUaueNgRbuXC9+MmcZRm275fhZ/zWuOQ/cSMaYNXmT9Ttfl+dZkpKabsVrtQFXKlNKcn8JJi7zkJErh66xJx1gOAA+XkcX/Te11VO41Zm26+YYgiDvCTJ5vSkdqfk/OouWWMM9jEzrxzxJSzAPOEY5OkUPA8pdLU0G0JUKBdAQkCAwEAAQ==';
const OTA_ENDPOINTS = [
    'zrun-www-dev' => 'https://www.zgntec.com/hy-cloud/app/dev/upgrade',
    'zrun-www-prod' => 'https://www.zgntec.com/hy-cloud/app/prod/upgrade',
    'zrun-www-test' => 'https://www.zgntec.com/hy-cloud/app/test/upgrade',
    'zrun-www-gray' => 'https://www.zgntec.com/hy-cloud/app/gray/upgrade',
    'zrun-www-v2' => 'https://www.zgntec.com/hy-cloud/app/v2/upgrade',
    'zrun-www-prod-upgrade-v2' => 'https://www.zgntec.com/hy-cloud/app/prod/upgrade/v2',
    'zrun-www-prod-firmware' => 'https://www.zgntec.com/hy-cloud/app/prod/firmware',
    'zrun-www-prod-ota' => 'https://www.zgntec.com/hy-cloud/app/prod/ota',
    'zrun-www-prod-version' => 'https://www.zgntec.com/hy-cloud/app/prod/version',
    'zrun-www-prod-check' => 'https://www.zgntec.com/hy-cloud/app/prod/check',
    'zrun-www-ota-upgrade' => 'https://www.zgntec.com/hy-cloud/ota/upgrade',
    'zrun-www-device-upgrade' => 'https://www.zgntec.com/hy-cloud/device/upgrade',
    'zrun-www-cloud-root' => 'https://www.zgntec.com/hy-cloud/',
    'zrun-www-root' => 'https://www.zgntec.com/',
    'zrun-bare-dev' => 'https://zgntec.com/hy-cloud/app/dev/upgrade',
    'zrun-bare-prod' => 'https://zgntec.com/hy-cloud/app/prod/upgrade',
    'zrun-bare-test' => 'https://zgntec.com/hy-cloud/app/test/upgrade',
    'zrun-bare-gray' => 'https://zgntec.com/hy-cloud/app/gray/upgrade',
    'zrun-bare-v2' => 'https://zgntec.com/hy-cloud/app/v2/upgrade',
    'zrun-bare-prod-upgrade-v2' => 'https://zgntec.com/hy-cloud/app/prod/upgrade/v2',
    'zrun-bare-prod-firmware' => 'https://zgntec.com/hy-cloud/app/prod/firmware',
    'zrun-bare-prod-ota' => 'https://zgntec.com/hy-cloud/app/prod/ota',
    'zrun-bare-prod-version' => 'https://zgntec.com/hy-cloud/app/prod/version',
    'zrun-bare-prod-check' => 'https://zgntec.com/hy-cloud/app/prod/check',
    'zrun-bare-ota-upgrade' => 'https://zgntec.com/hy-cloud/ota/upgrade',
    'zrun-bare-device-upgrade' => 'https://zgntec.com/hy-cloud/device/upgrade',
    'zrun-bare-cloud-root' => 'https://zgntec.com/hy-cloud/',
    'zrun-bare-root' => 'https://zgntec.com/',
];

function ota_json(int $status, array $data): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    try {
        echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        http_response_code(500);
        echo '{"ok":false,"error":"response encoding failed"}';
    }
    exit;
}

function ota_is_loopback(string $host): bool
{
    return in_array(strtolower(trim($host, '[]')), ['127.0.0.1', '::1', 'localhost'], true);
}

function ota_authorize(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowedOrigin = rtrim((string)getenv('BADGEGUARD_OTA_ALLOWED_ORIGIN'), '/');
    $helperToken = (string)getenv('BADGEGUARD_OTA_HELPER_TOKEN');

    if (($allowedOrigin === '') !== ($helperToken === '')) {
        ota_json(503, ['ok' => false, 'error' => 'remote helper requires both origin and token configuration']);
    }
    if ($allowedOrigin !== '') {
        $parts = parse_url($allowedOrigin);
        $validOrigin = is_array($parts) && isset($parts['scheme'], $parts['host'])
            && !array_intersect(['user', 'pass', 'path', 'query', 'fragment'], array_keys($parts))
            && ($parts['scheme'] === 'https' || ($parts['scheme'] === 'http' && ota_is_loopback($parts['host'])));
        if (!$validOrigin) {
            ota_json(503, ['ok' => false, 'error' => 'remote origin must be an HTTPS origin without a path']);
        }
        if (strlen($helperToken) < 32 || $origin !== $allowedOrigin) {
            ota_json(403, ['ok' => false, 'error' => 'origin is not allowed']);
        }
        header('Access-Control-Allow-Origin: ' . $allowedOrigin);
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-BadgeGuard-Helper-Token');
        header('Vary: Origin');
        $provided = $_SERVER['HTTP_X_BADGEGUARD_HELPER_TOKEN'] ?? '';
        if ($_SERVER['REQUEST_METHOD'] !== 'OPTIONS' && !hash_equals($helperToken, $provided)) {
            ota_json(403, ['ok' => false, 'error' => 'invalid helper token']);
        }
        return;
    }

    $hostHeader = $_SERVER['HTTP_HOST'] ?? '';
    $host = parse_url('http://' . $hostHeader, PHP_URL_HOST) ?: '';
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (int)($_SERVER['SERVER_PORT'] ?? 0) === 443;
    $scheme = $https ? 'https' : 'http';
    $serverOrigin = strtolower($scheme . '://' . $hostHeader);
    $sameOrigin = $origin !== '' && hash_equals($serverOrigin, strtolower($origin));
    $loopback = ota_is_loopback($host) && ota_is_loopback($remote);
    if (($sameOrigin && ($https || $loopback)) || ($origin === '' && $loopback)) {
        return;
    }
    ota_json(403, ['ok' => false, 'error' => 'cross-origin remote helper requires origin and token configuration']);
}

function ota_headers(): array
{
    $aesKey = (string)getenv('BADGEGUARD_OTA_AES_KEY');
    if (strlen($aesKey) !== 16) {
        throw new RuntimeException('BADGEGUARD_OTA_AES_KEY must be configured as a 16-byte value');
    }

    $publicDer = base64_decode(OTA_RSA_PUBLIC_KEY_B64, true);
    if ($publicDer === false) {
        throw new RuntimeException('invalid OTA RSA public key');
    }
    $publicPem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($publicDer), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $publicKey = openssl_pkey_get_public($publicPem);
    if ($publicKey === false || !openssl_public_encrypt('appSdk2025', $encryptedRule, $publicKey, OPENSSL_PKCS1_PADDING)) {
        throw new RuntimeException('could not build appSdkRule header');
    }

    $agent = json_encode(['timeStamp' => (string)time(), 'saltr' => 'appSdkSaltr'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $encryptedAgent = openssl_encrypt($agent, 'aes-128-ecb', $aesKey, OPENSSL_RAW_DATA);
    if ($encryptedAgent === false) {
        throw new RuntimeException('could not build appSdkAgent header');
    }
    return [
        'appSdkRule' => base64_encode($encryptedRule),
        'appSdkAgent' => base64_encode($encryptedAgent),
        'Content-Type' => 'application/json',
    ];
}

function ota_request(string $url, string $body, array $headers): array
{
    $headerLines = [];
    foreach ($headers as $name => $value) {
        $headerLines[] = $name . ': ' . $value;
    }
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headerLines),
            'content' => $body,
            'timeout' => 15,
            'ignore_errors' => true,
            'follow_location' => 0,
            'max_redirects' => 0,
            'protocol_version' => 1.1,
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);

    set_error_handler(static function (int $severity, string $message): never {
        throw new ErrorException($message, 0, $severity);
    });
    try {
        $stream = fopen($url, 'rb', false, $context);
        if ($stream === false) {
            throw new RuntimeException('upstream connection failed');
        }
        $responseBody = stream_get_contents($stream, 65537);
        fclose($stream);
        if ($responseBody === false) {
            throw new RuntimeException('upstream response could not be read');
        }
    } finally {
        restore_error_handler();
    }
    if (strlen($responseBody) > 65536) {
        throw new RuntimeException('upstream response exceeded 64 KiB');
    }

    $status = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $match)) {
            $status = (int)$match[1];
        }
    }
    try {
        $decoded = json_decode($responseBody, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        $decoded = null;
    }
    if (is_array($decoded)) {
        $bodyData = is_array($decoded['body'] ?? null) ? $decoded['body'] : [];
        $result = [
            'code' => isset($decoded['code']) && is_scalar($decoded['code']) ? (string)$decoded['code'] : '',
            'msg' => isset($decoded['msg']) && is_scalar($decoded['msg']) ? (string)$decoded['msg'] : '',
            'body' => [],
        ];
        foreach (['download_address', 'upgrade_version', 'upgrade_size', 'upgrade_content', 'upgrade_title'] as $key) {
            if (isset($bodyData[$key]) && is_scalar($bodyData[$key])) {
                $result['body'][$key] = (string)$bodyData[$key];
            }
        }
    } else {
        $result = ['raw' => substr($responseBody, 0, 4096)];
    }
    return ['upstreamStatus' => $status, 'response' => $result];
}

ota_authorize();
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    ota_json(405, ['ok' => false, 'error' => 'POST required']);
}

$raw = file_get_contents('php://input', false, null, 0, 8193);
if ($raw === false || strlen($raw) > 8192) {
    ota_json(413, ['ok' => false, 'error' => 'request body exceeds 8 KiB']);
}
try {
    $input = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
} catch (JsonException) {
    ota_json(400, ['ok' => false, 'error' => 'request body must be valid JSON']);
}
if (!is_array($input) || array_diff(array_keys($input), ['endpointId', 'model', 'version']) !== []) {
    ota_json(400, ['ok' => false, 'error' => 'only endpointId, model, and version are accepted']);
}
$endpointId = $input['endpointId'] ?? '';
$model = trim((string)($input['model'] ?? ''));
$version = trim((string)($input['version'] ?? ''));
if (!is_string($endpointId) || !isset(OTA_ENDPOINTS[$endpointId])) {
    ota_json(400, ['ok' => false, 'error' => 'endpoint is not enabled by this helper']);
}
if (!preg_match('/^[\x20-\x7E]{1,80}$/D', $model) || !preg_match('/^[\x20-\x7E]{1,80}$/D', $version)) {
    ota_json(400, ['ok' => false, 'error' => 'model and version must each contain 1–80 printable ASCII characters']);
}
if (preg_match('/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{16}$/D', $model)) {
    ota_json(400, ['ok' => false, 'error' => 'model resembles an authKey and is blocked']);
}

try {
    $body = json_encode(['model' => $model, 'type' => 'OTA', 'version' => $version], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $result = ota_request(OTA_ENDPOINTS[$endpointId], $body, ota_headers());
    ota_json(200, ['ok' => true, 'endpointId' => $endpointId, 'endpointUrl' => OTA_ENDPOINTS[$endpointId], ...$result]);
} catch (RuntimeException | ErrorException | JsonException $error) {
    error_log('BadgeGuard OTA helper: ' . $error->getMessage());
    ota_json(502, ['ok' => false, 'error' => $error->getMessage()]);
}
