import React from 'react';
import MemoryAlbum from './MemoryAlbum';
import albumData from '../album-data';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: albumData.background?.color || '#e7e3da' }}>
      <MemoryAlbum data={albumData} />
    </div>
  );
}
