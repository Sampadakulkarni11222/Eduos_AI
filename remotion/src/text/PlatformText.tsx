import React from 'react';
import { AbsoluteFill } from 'remotion';
import { ROLE_THEME } from '../config';
import { Parchment } from '../components/Brand';
import { Shot } from '../components/Shot';
import { ShotSequence } from '../components/ShotSequence';
import { TextPlate } from './overlays';

/**
 * 7.6–17.6s — one platform. Same three captures and camera moves as the
 * narrated cut; the lower-third sentences are replaced by a label and the
 * module groups the Admin console actually carries (WORKSPACE, PEOPLE,
 * ACADEMIC OPS, FINANCE, COMMUNICATION, SYSTEM in its sidebar).
 */
export const PlatformText: React.FC = () => (
  <AbsoluteFill>
    <Parchment />
    <ShotSequence
      beats={[
        {
          weight: 1,
          node: (
            <AbsoluteFill>
              <Shot src="signin.png" camera={[{ at: 0, x: 960, y: 560, z: 1.02 }, { at: 1, x: 960, y: 590, z: 1.32 }]} />
              <TextPlate kicker="EduOS" title="One connected platform" from={0.14} to={1.1} />
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
              <TextPlate
                kicker="Super Admin"
                title="Branded per school"
                pills={['Theme', 'Branding', 'Domains']}
                accent={ROLE_THEME.superAdmin.accent}
                from={0.12}
                corner="top-left"
              />
            </AbsoluteFill>
          ),
        },
        {
          weight: 0.95,
          enter: 'slide-left',
          node: (
            <AbsoluteFill>
              <Shot src="admin-dashboard.png" camera={[{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 330, z: 1.22 }]} />
              <TextPlate
                kicker="School Admin"
                title="Built for school operations"
                pills={['School Administration', 'Academics', 'Finance', 'Communication']}
                accent={ROLE_THEME.admin.accent}
                from={0.1}
                to={0.96}
              />
            </AbsoluteFill>
          ),
        },
      ]}
    />
  </AbsoluteFill>
);
