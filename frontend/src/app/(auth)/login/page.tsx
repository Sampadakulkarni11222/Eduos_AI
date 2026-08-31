import { SignIn } from '@/components/sign-in';

/**
 * The platform door.
 *
 * No school, so `SignIn` renders in platform mode: EduOS AI branding, and only
 * a Super Admin may complete a sign-in here. A school's own people sign in at
 * their school's address (`/oakridge`), which renders the same component with
 * that school passed in.
 */
export default function PlatformLoginPage() {
  return <SignIn />;
}
