# AddressBook Edge Stream

## Overview

AddressBook Edge Stream is a contact management application that allows users to:

- Scan business cards using OCR
- Extract contact details from voice input
- Manage contacts
- Create contact relationships
- Organize contacts into groups
- Export contacts as VCF files

---

## Tech Stack

### Frontend
- React
- TypeScript
- Vite

### Backend
- NestJS
- TypeScript

### Database
- PostgreSQL
- Drizzle ORM

### OCR
- Tesseract.js

### Speech-to-Text
- Faster Whisper

### Containerization
- Docker
- Docker Compose

---

## Prerequisites

- Docker Desktop
- Node.js 22+
- Git

---

## Setup Instructions

### Clone the project

```bash
git clone <repository-url>
cd AddressBook-edge-stream
```

### Install dependencies

```bash
npm install
```

### Build and start the application

```bash
docker compose up --build
```

### Frontend

```
http://localhost:5173
```

### Backend API

```
http://localhost:3000
```

---

## Features

- Business Card OCR
- Voice Contact Extraction
- Contact CRUD
- Duplicate Detection
- Contact Groups
- Contact Relationships
- Export Contacts as VCF

---

## Database

PostgreSQL is used as the database.

Database schema is located at:

```
apps/api/src/db/schema.ts
```

---

## Sample Test Data

Sample seed data is available in:

```
scripts/seed-sample-data.js
```

Run automatically when the database is empty.

---

## Author

Barani K