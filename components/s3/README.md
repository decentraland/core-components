# @dcl/s3-component

AWS S3 component for object storage operations with Amazon Simple Storage Service.

## Installation

```bash
npm install @dcl/s3-component
```

## Usage

```typescript
import { createS3Component } from '@dcl/s3-component'

const s3 = await createS3Component({ config })

// Upload an object
await s3.uploadObject('path/to/file.txt', 'content', 'text/plain')

// Download an object
const content = await s3.downloadObject('path/to/file.txt')

// Delete an object
await s3.deleteObject('path/to/file.txt')

// List objects
const keys = await s3.listObjects('path/to/', 100)

// Get object metadata
const metadata = await s3.getObjectMetadata('path/to/file.txt')

// Check if object exists
const exists = await s3.objectExists('path/to/file.txt')

// Check if multiple objects exist
const results = await s3.multipleObjectsExist(['file1.txt', 'file2.txt', 'file3.txt'])
// Returns: { 'file1.txt': true, 'file2.txt': false, 'file3.txt': true }
```

## Configuration

The component requires the following environment variables:

- `AWS_S3_BUCKET_NAME`: The name of the S3 bucket
- `AWS_S3_ENDPOINT` (optional): Custom S3 endpoint for testing (e.g., LocalStack)
- `AWS_REGION` (optional): AWS region (default: uses AWS SDK default)

## Features

- Upload objects (strings or Buffers)
- Download objects
- Delete objects
- List objects with prefix filtering
- Get object metadata (size, type, modified date, ETag)
- Check object existence (single or multiple objects)
- Parallel execution for multiple object checks
- Support for local testing with LocalStack/MinIO
