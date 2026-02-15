const express = require('express');
const Redis = require('ioredis');
const amqp = require('amqplib');
const { authenticateSequelize } = require('./sequelize');
const authRoutes = require('./routes/auth-routes');
const systemRoutes = require('./routes/system-routes');
const itemsRoutes = require('./routes/items-routes');
const organizationsRoutes = require('./routes/organizations-routes');
const ordersRoutes = require('./routes/orders-routes');
const usersRoutes = require('./routes/users-routes');
const rolesRoutes = require('./routes/roles-routes');
const permissionsRoutes = require('./routes/permissions-routes');
const licensesRoutes = require('./routes/licenses-routes');
const salesInvoicesRoutes = require('./routes/sales-invoices-routes');
const customersRoutes = require('./routes/customers-routes');
const devRoutes = require('./routes/dev-routes');
const { authenticateRequest } = require('./middleware/authz');
const {
  errorResponseShapeMiddleware,
  notFoundHandler,
  errorHandler,
} = require('./middleware/error-handler');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(errorResponseShapeMiddleware);

let sequelize;
let redisClient;
let amqpConn;

const status = {
  mysql: false,
  redis: false,
  amqp: false,
};

app.locals.serviceStatus = status;

async function connectMysql() {
  sequelize = await authenticateSequelize();
  status.mysql = true;
}

async function connectMysqlWithRetry(maxAttempts = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await connectMysql();
      return;
    } catch (err) {
      const lastAttempt = attempt === maxAttempts;
      console.error(
        `MySQL connection failed (attempt ${attempt}/${maxAttempts}):`,
        err.message
      );
      if (lastAttempt) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function connectRedis() {
  redisClient = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
  await redisClient.ping();
  status.redis = true;
}

async function connectAmqp() {
  amqpConn = await amqp.connect(
    process.env.AMQP_URL || 'amqp://guest:guest@amqp:5672'
  );
  status.amqp = true;
}

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/dev', devRoutes);
app.use('/api/v1', authenticateRequest);
app.use('/api/v1/items', itemsRoutes);
app.use('/api/v1/organizations', organizationsRoutes);
app.use('/api/v1/orders', ordersRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/roles', rolesRoutes);
app.use('/api/v1/permissions', permissionsRoutes);
app.use('/api/v1/licenses', licensesRoutes);
app.use('/api/v1/sales-invoices', salesInvoicesRoutes);
app.use('/api/v1/customers', customersRoutes);
app.use('/api/v1', systemRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

async function bootstrap() {
  try {
    await connectMysqlWithRetry();
    console.log('MySQL connected');
  } catch (err) {
    console.error('MySQL connection failed after retries:', err.message);
    process.exit(1);
  }

  try {
    await connectRedis();
    console.log('Redis connected');
  } catch (err) {
    console.error('Redis connection failed:', err.message);
  }

  try {
    await connectAmqp();
    console.log('AMQP connected');
  } catch (err) {
    console.error('AMQP connection failed:', err.message);
  }

  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
}

process.on('SIGINT', async () => {
  try {
    if (sequelize) {
      await sequelize.close();
    }
    if (redisClient) {
      await redisClient.quit();
    }
    if (amqpConn) {
      await amqpConn.close();
    }
  } finally {
    process.exit(0);
  }
});

bootstrap();
