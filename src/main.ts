import 'dotenv/config';
import { setDefaultResultOrder } from 'dns';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  const saveRawBody = (req: any, _res: any, buffer: Buffer) => {
    if (buffer?.length) {
      req.rawBody = Buffer.from(buffer);
    }
  };

  app.use(json({ limit: '25mb', verify: saveRawBody }));
  app.use(urlencoded({ extended: true, limit: '25mb', verify: saveRawBody }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('NestJS API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document);
  SwaggerModule.setup('api-docs', app, document);

  const port = process.env.PORT ?? 3000;

  // Enable CORS for local frontend, Swagger, and VS Code Live Server.'https://braens.vercel.app'
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173' || 'https://braens.vercel.app';
  const configuredOrigins = frontend.includes(',')
    ? frontend.split(',').map((s) => s.trim())
    : [frontend.trim()];
  const allowedOrigins = Array.from(
    new Set([
      ...configuredOrigins,
      'https://braens.vercel.app',
      'http://localhost:5173',
      'http://localhost:5174',
     

    ]),
  );

  // Allow wildcard origin in development if explicitly set to '*'
  const allowAllOrigins =
    configuredOrigins.length === 1 && configuredOrigins[0] === '*';

  app.enableCors({
    origin: allowAllOrigins
      ? true
      : (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
          }

          callback(null, false);
        },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With',
    credentials: true,
  });

  console.log('CORS origins:', allowAllOrigins ? '*' : allowedOrigins);

  await app.listen(port);

  console.log(`Swagger running at: http://localhost:${port}/docs`);
}

bootstrap().catch((error) => {
  console.error('Failed to start application', error);
  process.exit(1);
});
