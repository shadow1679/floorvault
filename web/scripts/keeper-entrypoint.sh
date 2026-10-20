#!/bin/sh
# Hosted keeper entrypoint: rebuilds the Foundry keystore from secrets, then runs the keeper.
#   KEEPER_ACCOUNT        keystore name (plain env)
#   KEEPER_KEYSTORE_JSON  contents of ~/.foundry/keystores/<KEEPER_ACCOUNT> (secret)
#   KEEPER_PASSWORD       that keystore's password (secret)
set -eu
: "${KEEPER_ACCOUNT:?missing KEEPER_ACCOUNT}"
: "${KEEPER_KEYSTORE_JSON:?missing KEEPER_KEYSTORE_JSON}"
: "${KEEPER_PASSWORD:?missing KEEPER_PASSWORD}"

umask 077
keystores="$HOME/.foundry/keystores"
mkdir -p "$keystores"
printf '%s' "$KEEPER_KEYSTORE_JSON" > "$keystores/$KEEPER_ACCOUNT"
printf '%s' "$KEEPER_PASSWORD" > /tmp/keeper.pass
export KEEPER_PASSWORD_FILE=/tmp/keeper.pass
# The keeper (and the `cast` it spawns) only need the files, not the secrets in their environment.
unset KEEPER_KEYSTORE_JSON KEEPER_PASSWORD

exec node scripts/keeper.mjs
