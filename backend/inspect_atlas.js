import mongoose from 'mongoose';
import dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const ATLAS_URI = 'mongodb+srv://kulkarnisampada07_db_user:bPKMqeW8OWkoE6eQ@cluster0.alhw4up.mongodb.net/school_erp?appName=Cluster0';

async function inspectStudent() {
  console.log('Connecting to Atlas DB...');
  try {
    await mongoose.connect(ATLAS_URI);

    const Account = mongoose.model('Account', new mongoose.Schema({
      phoneE164: String,
      email: String
    }));
    
    const Profile = mongoose.model('Profile', new mongoose.Schema({
      accountId: mongoose.Schema.Types.ObjectId,
      roleId: mongoose.Schema.Types.ObjectId,
      displayName: String,
      status: String,
      deletedAt: Date
    }));

    const Role = mongoose.model('Role', new mongoose.Schema({
      key: String,
      name: String
    }));

    console.log('\n--- Searching for Student Account & Profile (+910000003001) ---');
    const studentAccount = await Account.findOne({ phoneE164: '+910000003001' });
    if (!studentAccount) {
      console.log('Account for +910000003001 NOT FOUND.');
    } else {
      console.log('Account found:', studentAccount);
      const profiles = await Profile.find({ accountId: studentAccount._id });
      console.log(`Found ${profiles.length} profiles linked to this account:`);
      for (const p of profiles) {
        const role = await Role.findById(p.roleId);
        console.log(` - Profile Name: "${p.displayName}", Role: "${role?.key}" (${p.roleId}), Status: "${p.status}", DeletedAt: ${p.deletedAt}`);
      }
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

inspectStudent();
