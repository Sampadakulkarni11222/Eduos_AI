import mongoose from 'mongoose';
import dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const ATLAS_URI = 'mongodb+srv://kulkarnisampada07_db_user:bPKMqeW8OWkoE6eQ@cluster0.alhw4up.mongodb.net/school_erp?appName=Cluster0';

async function list() {
  console.log('Connecting to MongoDB Atlas...');
  try {
    await mongoose.connect(ATLAS_URI);
    
    // Define minimal schemas to avoid compilation errors
    const Role = mongoose.model('Role', new mongoose.Schema({
      key: String,
      name: String
    }));
    
    const Account = mongoose.model('Account', new mongoose.Schema({
      phoneE164: String,
      email: String
    }));
    
    const Profile = mongoose.model('Profile', new mongoose.Schema({
      accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
      roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
      displayName: String
    }));

    const teacherRole = await Role.findOne({ key: 'TEACHER' });
    if (!teacherRole) {
      console.log('TEACHER role not found in database.');
      await mongoose.disconnect();
      return;
    }

    const teacherProfiles = await Profile.find({ roleId: teacherRole._id })
      .populate('accountId');

    console.log(`\nFound ${teacherProfiles.length} Teacher Profiles in database:\n`);
    
    teacherProfiles.forEach((p, idx) => {
      const account = p.accountId;
      console.log(`${idx + 1}. Name: ${p.displayName}`);
      console.log(`   Phone: ${account?.phoneE164 || 'N/A'}`);
      console.log(`   Email: ${account?.email || 'N/A'}`);
      console.log('------------------------------');
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

list();
