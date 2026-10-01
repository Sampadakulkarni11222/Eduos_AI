import React from 'react';
import { Img, staticFile } from 'remotion';
import { BRAND, VIDEO } from '../config';

/** A region of a real capture, scaled into a box — used for side-by-side comparisons. */
export const Crop: React.FC<{
  src: string;
  rect: [number, number, number, number];
  width: number;
  style?: React.CSSProperties;
}> = ({ src, rect, width, style }) => {
  const [x, y, w, h] = rect;
  const s = width / w;
  return (
    <div
      style={{
        width,
        height: h * s,
        overflow: 'hidden',
        position: 'relative',
        borderRadius: 16,
        boxShadow: '0 30px 70px -30px rgba(58,34,41,.5)',
        outline: `1px solid ${BRAND.hairline}`,
        ...style,
      }}
    >
      <Img
        src={staticFile(`screenshots/${src}`)}
        style={{ position: 'absolute', left: -x * s, top: -y * s, width: VIDEO.width * s, height: VIDEO.height * s }}
      />
    </div>
  );
};
