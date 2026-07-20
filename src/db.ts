import mongoose from 'mongoose';
import { logger } from './logger';

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }

  try {
    await mongoose.connect(uri, {
      maxPoolSize:              3,     // free instance has limited RAM; default is 5
      serverSelectionTimeoutMS: 5000,  // fail fast if Atlas is unreachable
      socketTimeoutMS:          45000, // drop stale sockets after 45s
      bufferCommands:           false, // throw immediately if disconnected rather than queuing
    });
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
}
