#!/bin/sh
# Runs once, on the first start of an empty data volume.
# Creates n8n's own database and role, and the application's login role.
# db/schema.sql (Alembic baseline) later grants the application role its table privileges.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v n8n_pw="$N8N_DB_PASSWORD" -v app_pw="$APP_DB_PASSWORD" <<'EOSQL'
CREATE ROLE n8n LOGIN PASSWORD :'n8n_pw';
CREATE DATABASE n8n OWNER n8n;
CREATE ROLE constructiq_app LOGIN PASSWORD :'app_pw';
EOSQL
