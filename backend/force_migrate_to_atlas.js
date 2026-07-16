// force_migrate_to_atlas.js
// Drops the Atlas database to ensure a clean slate, then migrates all local collections.

import mongoose from 'mongoose';
import dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const localUri = 'mongodb://localhost:27017/school_erp';
const atlasUri = 'mongodb+srv://kulkarnisampada07_db_user:bPKMqeW8OWkoE6eQ@cluster0.alhw4up.mongodb.net/school_erp?appName=Cluster0';

async function connect(uri) {
  const conn = mongoose.createConnection(uri);
  await conn.asPromise();
  return conn;
}

async function forceMigrate() {
  console.log('Connecting to Atlas DB to drop existing data...');
  const atlasConn = await connect(atlasUri);
  
  // Drop database on Atlas
  console.log('Dropping Atlas database for clean slate...');
  await atlasConn.dropDatabase();
  console.log('Atlas database dropped.');
  await atlasConn.close();

  console.log('Reconnecting to clean Atlas DB...');
  const cleanAtlasConn = await connect(atlasUri);
  console.log('Connecting to local DB...');
  const localConn = await connect(localUri);

  // Get collections from local DB
  const collections = await localConn.db.listCollections().toArray();
  console.log(`Found ${collections.length} collections locally to migrate.`);

  for (const collInfo of collections) {
    const collName = collInfo.name;
    const localColl = localConn.db.collection(collName);
    const atlasColl = cleanAtlasConn.db.collection(collName);
    
    const docs = await localColl.find({}).toArray();
    if (docs.length === 0) {
      console.log(`Skipping empty collection: ${collName}`);
      continue;
    }

    console.log(`Migrating ${docs.length} docs to collection "${collName}"...`);
    await atlasColl.insertMany(docs);
  }

  await localConn.close();
  await cleanAtlasConn.close();
  console.log('\nMigration completed successfully! Your Atlas DB is now a clean, exact copy of your local DB.');
}

forceMigrate().catch(err => {
  console.error('Migration failed:', err);
});
