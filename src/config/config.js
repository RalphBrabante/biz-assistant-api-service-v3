const env = process.env.NODE_ENV || 'development';

const base = {
  username: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppassword',
  database: process.env.DB_NAME || 'appdb',
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT || 3306),
  dialect: 'mysql',
  logging: false,
  pool: {
    max: 10,
    min: 0,
    idle: 10000,
  },
};

module.exports = {
  env,
  development: { ...base },
  test: { ...base },
  production: { ...base },
};
