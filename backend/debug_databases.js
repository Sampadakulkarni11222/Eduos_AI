import mongoose from 'mongoose';
import dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const LOCAL_URI = 'mongodb://localhost:27017/school_erp';
const ATLAS_URI = 'mongodb+srv://kulkarnisampada07_db_user:bPKMqeW8OWkoE6eQ@cluster0.alhw4up.mongodb.net/school_erp?appName=Cluster0';

async function debug() {
  console.log('--- LOCAL DATABASE CHECK ---');
  try {
    const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();
    const Account = localConn.model('Account', new mongoose.Schema({ phoneE164: String, email: String }));
    const Student = localConn.model('Student', new mongoose.Schema({ admissionNo: String }));
    
    console.log(`Local Accounts count: ${await Account.countDocuments()}`);
    console.log(`Local Students count: ${await Student.countDocuments()}`);
    
    const sample = await Account.findOne({ phoneE164: '+910000003001' });
    console.log(`Does local have +910000003001? ${sample ? 'YES' : 'NO'}`);
    
    await localConn.close();
  } catch (err) {
    console.error('Local DB Error:', err.message);
  }

  console.log('\n--- ATLAS DATABASE CHECK ---');
  try {
    const atlasConn = await mongoose.createConnection(ATLAS_URI).asPromise();
    const Account = atlasConn.model('Account', new mongoose.Schema({ phoneE164: String, email: String }));
    const Student = atlasConn.model('Student', new mongoose.Schema({ admissionNo: String }));
    
    console.log(`Atlas Accounts count: ${await Account.countDocuments()}`);
    console.log(`Atlas Students count: ${await Student.countDocuments()}`);
    
    const sample = await Account.findOne({ phoneE164: '+910000003001' });
    console.log(`Does Atlas have +910000003001? ${sample ? 'YES' : 'NO'}`);
    
    await atlasConn.close();
  } catch (err) {
    console.error('Atlas DB Error:', err.message);
  }
}

debug();
