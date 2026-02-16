const env = process.env.NODE_ENV || 'development';

const base = {
  username: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppassword',
  database: process.env.DB_NAME || 'appdb',
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT || 3306),
  dialect: 'mysql',
  logging: false,
  dialectOptions: {
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 20000),
  },
  pool: {
    max: Number(process.env.DB_POOL_MAX || 4),
    min: Number(process.env.DB_POOL_MIN || 0),
    acquire: Number(process.env.DB_POOL_ACQUIRE_MS || 20000),
    idle: Number(process.env.DB_POOL_IDLE_MS || 5000),
    evict: Number(process.env.DB_POOL_EVICT_MS || 1000),
  },
};

module.exports = {
  env,
  development: { ...base },
  test: { ...base },
  production: { ...base },
};
