import { compactMap } from './compact-lens';
self.onmessage = ({ data: { key, shape } }) => {
  const map = compactMap(shape);
  self.postMessage({ key, ...map }, { transfer: [map.data.buffer] });
};
