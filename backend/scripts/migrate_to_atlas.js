// migrate_to_atlas.js
// Script to copy data from local MongoDB to MongoDB Atlas.
// Usage: node scripts/migrate_to_atlas.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';

// Configure DNS to prevent querySrv ECONNREFUSED on some networks
dns.setServers(['8.8.8.8', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars from project root relative to this script
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const localUri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/school_erp';
const atlasUri = process.env.MONGO_URI_ATLAS ?? process.env.MONGO_URI; // Fallback if ATLAS not set separately

async function connect(uri) {
  const conn = mongoose.createConnection(uri);
  await conn.asPromise();
  return conn;
}

async function migrate() {
  console.log('Connecting to local DB...');
  const localConn = await connect(localUri);
  console.log('Connecting to Atlas DB...');
  const atlasConn = await connect(atlasUri);

  // Get collection names from local DB
  const collections = await localConn.db.listCollections().toArray();
  console.log(`Found ${collections.length} collections to migrate.`);

  for (const collInfo of collections) {
    const collName = collInfo.name;
    const localColl = localConn.db.collection(collName);
    const atlasColl = atlasConn.db.collection(collName);
    const docs = await localColl.find({}).toArray();
    if (docs.length === 0) {
      console.log(`Skipping empty collection: ${collName}`);
      continue;
    }
    // Insert documents into Atlas (merge mode)
    console.log(`Migrating ${docs.length} docs from ${collName}...`);
    try {
      await atlasColl.insertMany(docs, { ordered: false });
    } catch (insertErr) {
      // ignore duplicate key errors if some documents already exist
      if (insertErr.code !== 11000) {
        console.warn(`Warning inserting into ${collName}:`, insertErr.message);
      }
    }
  }

  console.log('Migration completed successfully.');
  await localConn.close();
  await atlasConn.close();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});

