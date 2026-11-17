import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import { apiRoutes } from './routes';
import { authenticateRequest } from './middleware/auth';

let redis: Redis.Redis;

export const initializeServer = async (): Promise<Express> => {
  const app = express();

  // Initialize Redis client
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });

  // Middleware
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  }));
  app.use(express.json());
  app.use(authenticateRequest);

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Store redis instance in app locals for route handlers
  app.locals.redis = redis;

  // Mount API routes
  app.use('/api/v1', apiRoutes);

  return app;
};

export const startServer = async (): Promise<void> => {
  const app = await initializeServer();
  const port = parseInt(process.env.PORT || '4000');

  app.listen(port, () => {
    console.log(`REST API server running on http://localhost:${port}/api/v1`);
  });
};

export default initializeServer;
