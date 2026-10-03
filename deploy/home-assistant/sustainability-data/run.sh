#!/usr/bin/with-contenv bashio
# Options from the add-on configuration become environment variables for server.mjs.
export HA_ENERGY_SENSOR="$(bashio::config 'energy_sensor')"
export SD_PROVIDER="$(bashio::config 'provider')"
export SD_METHODOLOGY_URI="$(bashio::config 'methodology_uri')"
export SD_TARGET="$(bashio::config 'target')"
export SD_TARGET_TYPE="$(bashio::config 'target_type')"
export SD_GRID_INTENSITY="$(bashio::config 'grid_intensity_gco2e_per_kwh')"
export HA_API="http://supervisor/core/api"
export HA_TOKEN="${SUPERVISOR_TOKEN}"
export SD_STATE_DIR="/data"
export PORT=8099
exec node /app/server.mjs
