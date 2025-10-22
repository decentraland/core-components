import { 
  DeleteObjectCommand, 
  GetObjectCommand, 
  HeadObjectCommand, 
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'

/**
 * Sets up mocks for AWS SDK S3 components (call once)
 */
export function setupS3Mocks(): void {
  // Mock command constructors to return objects with input property
  ;(PutObjectCommand as any).mockImplementation((params: any) => ({ input: params }))
  ;(GetObjectCommand as any).mockImplementation((params: any) => ({ input: params }))
  ;(DeleteObjectCommand as any).mockImplementation((params: any) => ({ input: params }))
  ;(ListObjectsV2Command as any).mockImplementation((params: any) => ({ input: params }))
  ;(HeadObjectCommand as any).mockImplementation((params: any) => ({ input: params }))
}

/**
 * Updates the S3Client mock to return the specified client
 * @param mockS3Client - The mock S3 client to be returned by S3Client constructor
 */
export function setMockS3Client(mockS3Client: any): void {
  ;(S3Client as any).mockImplementation(() => mockS3Client)
}
