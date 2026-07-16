import mongoose from 'mongoose';
import dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const ATLAS_URI = 'mongodb+srv://kulkarnisampada07_db_user:bPKMqeW8OWkoE6eQ@cluster0.alhw4up.mongodb.net/school_erp?appName=Cluster0';

async function check() {
  console.log('Connecting to MongoDB Atlas...');
  try {
    await mongoose.connect(ATLAS_URI);
    console.log('Connected.');

    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`Found ${collections.length} collections:`);

    for (const col of collections) {
      const count = await mongoose.connection.db.collection(col.name).countDocuments({});
      console.log(` - ${col.name}: ${count} documents`);
    }

    if (collections.length === 0) {
      console.log('\nDatabase is completely EMPTY!');
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

check();
