#!/bin/sh
set -eu

identity=${PALOT_LOCAL_SIGNING_IDENTITY:-Palot Local Development}
keychain=$(
    security default-keychain -d user \
        | sed -e 's/^[[:space:]]*//' -e 's/"//g'
)

identity_exists() {
    security find-identity -v -p codesigning "$keychain" 2>/dev/null \
        | grep -F "\"$identity\"" >/dev/null
}

if identity_exists; then
    printf '%s\n' "Code-signing identity already exists: $identity"
    exit 0
fi

if security find-certificate -c "$identity" "$keychain" >/dev/null 2>&1; then
    security delete-certificate -c "$identity" "$keychain"
fi

temporary_root=$(mktemp -d)
cleanup() {
    rm -rf "$temporary_root"
}
trap cleanup EXIT HUP INT TERM
umask 077

private_key="$temporary_root/private-key.pem"
keychain_private_key="$temporary_root/private-key-rsa.pem"
certificate="$temporary_root/certificate.pem"

openssl req \
    -x509 \
    -newkey rsa:3072 \
    -sha256 \
    -days 3650 \
    -nodes \
    -keyout "$private_key" \
    -out "$certificate" \
    -subj "/CN=$identity/O=Palot/OU=Local Code Signing" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,digitalSignature,keyCertSign" \
    -addext "extendedKeyUsage=codeSigning"

openssl rsa \
    -in "$private_key" \
    -traditional \
    -out "$keychain_private_key"

security import "$certificate" \
    -k "$keychain" \
    -t cert \
    -f pemseq

security import "$keychain_private_key" \
    -k "$keychain" \
    -t priv \
    -f openssl \
    -T /usr/bin/codesign \
    -T /usr/bin/security

security add-trusted-cert \
    -r trustRoot \
    -p codeSign \
    -k "$keychain" \
    "$certificate"

if ! identity_exists; then
    printf '%s\n' "The certificate was imported but is not a valid signing identity." >&2
    printf '%s\n' "Open Keychain Access and set its Code Signing trust to Always Trust." >&2
    exit 1
fi

test_executable="$temporary_root/signing-test"
cp /usr/bin/true "$test_executable"
codesign --force --timestamp=none --sign "$identity" "$test_executable"
codesign --verify --strict "$test_executable"

printf '%s\n' "Created local code-signing identity: $identity"
