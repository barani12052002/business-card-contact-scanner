import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import express from 'express';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  console.log("Uploads:", existsSync("/app/uploads"));
  console.log("Processed:", existsSync("/app/uploads/processed"));
  app.use(
    '/uploads',
   express.static("/app/uploads")
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();