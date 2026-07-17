import mongoose from 'mongoose';
import dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const ATLAS_URI = 'mongodb+srv://kulkarnisampada07_db_user:bPKMqeW8OWkoE6eQ@cluster0.alhw4up.mongodb.net/school_erp?appName=Cluster0';

async function inspect() {
  console.log('Connecting to Atlas DB...');
  try {
    await mongoose.connect(ATLAS_URI);
    
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`Collections: ${collections.map(c => c.name).join(', ')}`);

    const Account = mongoose.model('Account', new mongoose.Schema({
      phoneE164: String,
      email: String
    }));
    
    const Profile = mongoose.model('Profile', new mongoose.Schema({
      accountId: mongoose.Schema.Types.ObjectId,
      roleId: mongoose.Schema.Types.ObjectId,
      displayName: String
    }));

    const Role = mongoose.model('Role', new mongoose.Schema({
      key: String,
      name: String
    }));

    console.log('\n--- Searching for Teacher Account & Profile (+910000000003) ---');
    const teacherAccount = await Account.findOne({ phoneE164: '+910000000003' });
    if (!teacherAccount) {
      console.log('Account for +910000000003 NOT FOUND.');
    } else {
      console.log('Account found:', teacherAccount);
      const profiles = await Profile.find({ accountId: teacherAccount._id });
      console.log(`Found ${profiles.length} profiles linked to this account:`);
      for (const p of profiles) {
        const role = await Role.findById(p.roleId);
        console.log(` - Profile Name: ${p.displayName}, Role: ${role?.key} (${p.roleId})`);
      }
    }

    console.log('\n--- Listing all Accounts ---');
    const allAccs = await Account.find({}).limit(5);
    console.log(`Total Accounts count in DB: ${await Account.countDocuments()}`);
    console.log('Sample accounts:', allAccs);

    console.log('\n--- Listing all Roles ---');
    const allRoles = await Role.find({});
    console.log('Roles:', allRoles.map(r => `${r.key}: ${r._id}`));

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

inspect();
