import React from 'react';
import { AbsoluteFill } from 'remotion';
import { ROLE_THEME } from '../config';
import { Parchment } from '../components/Brand';
import { Caption } from '../components/Caption';
import { Shot } from '../components/Shot';
import { ShotSequence } from '../components/ShotSequence';

/** 8–18s — one platform: the school's own door, its branding, its operations. */
export const Platform: React.FC = () => (
  <AbsoluteFill>
    <Parchment />
    <ShotSequence
      beats={[
        {
          weight: 1,
          node: (
            <AbsoluteFill>
              <Shot src="signin.png" camera={[{ at: 0, x: 960, y: 560, z: 1.02 }, { at: 1, x: 960, y: 590, z: 1.32 }]} />
              <Caption eyebrow="One platform" title="One platform for your entire school." sub="Every school signs in at its own branded door." from={0.12} to={1.1} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 1.05,
          enter: 'slide-left',
          node: (
            <AbsoluteFill>
              <Shot
                src="school-customization.png"
                camera={[{ at: 0, x: 960, y: 540, z: 1 }, { at: 0.55, x: 1060, y: 420, z: 1.32 }, { at: 1, x: 1070, y: 440, z: 1.36 }]}
                highlights={[{ rect: [690, 162, 773, 208], from: 0.45, to: 0.98, radius: 16 }]}
              />
              <Caption eyebrow="Super Admin" title="Theme and branding, per school." sub="Configured separately for each school on the platform." from={0.1} accent={ROLE_THEME.superAdmin.accent} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 0.95,
          enter: 'slide-left',
          node: (
            <AbsoluteFill>
              <Shot src="admin-dashboard.png" camera={[{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 330, z: 1.22 }]} />
              <Caption eyebrow="School Admin" title="School operations at a glance." sub="Students, tickets, announcements and admissions — one console." from={0.1} to={0.96} accent={ROLE_THEME.admin.accent} />
            </AbsoluteFill>
          ),
        },
      ]}
    />
  </AbsoluteFill>
);
