import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const mongoUri = 'mongodb://localhost:27017/school_erp';

async function run() {
  await mongoose.connect(mongoUri);
  const accounts = await mongoose.connection.db.collection('accounts').find({}).toArray();
  console.log('Accounts found:', accounts.map(a => ({ email: a.email, phone: a.phoneE164 })));
  process.exit(0);
}

run().catch(console.error);

