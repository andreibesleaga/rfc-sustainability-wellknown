#!/bin/sh
# Regenerates the certificates the transport and signature tests use. They are
# committed, so the suite never needs openssl; run this only to replace them.
# Every certificate is valid from 2020-01-01 to 2120-01-01 except expired.pem,
# which ended on 2020-01-02, and every private key is an Ed25519 or P-256 test key.
set -eu
cd "$(dirname "$0")"
rm -rf work && mkdir work
cat > work/ca.cnf <<'EOF'
[ ca ]
default_ca = CA_default
[ CA_default ]
dir = work
database = work/index.txt
new_certs_dir = work
serial = work/serial
default_md = default
policy = policy_any
unique_subject = no
copy_extensions = copy
[ policy_any ]
commonName = supplied
[ v3_ca ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF
: > work/index.txt; echo 01 > work/serial
START=20200101000000Z
END=21200101000000Z

root() { # name
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$1-key.pem" 2>/dev/null
  openssl req -new -key "$1-key.pem" -subj "/CN=$1" -out "work/$1.csr"
  openssl ca -batch -config work/ca.cnf -selfsign -keyfile "$1-key.pem" -in "work/$1.csr" \
    -startdate $START -enddate $END -extensions v3_ca -notext -out "$1.pem" 2>/dev/null
}
issue() { # issuer name dns start end [ca]
  openssl genpkey -algorithm Ed25519 -out "$2-key.pem"
  openssl req -new -key "$2-key.pem" -subj "/CN=$2" -addext "subjectAltName=DNS:$3" -out "work/$2.csr"
  ext=""
  if [ "${6:-}" = ca ]; then ext="-extensions v3_ca"; fi
  openssl ca -batch -config work/ca.cnf -cert "$1.pem" -keyfile "$1-key.pem" -in "work/$2.csr" \
    -startdate "$4" -enddate "$5" $ext -notext -out "$2.pem" 2>/dev/null
}

root ca
root other-ca
issue ca good good.test $START $END
issue ca wrong-host other.test $START $END
issue ca expired good.test $START 20200102000000Z
issue other-ca untrusted good.test $START $END
issue ca intermediate int.test $START $END ca
# a leaf below the intermediate, for a chain of two
issue intermediate chained good.test $START $END
# a self-signed leaf
openssl genpkey -algorithm Ed25519 -out self-signed-key.pem
openssl req -x509 -key self-signed-key.pem -subj "/CN=good.test" -addext "subjectAltName=DNS:good.test" \
  -days 36500 -out self-signed.pem
rm -rf work *.srl
