import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { WorkbenchProvider } from './context/WorkbenchContext';
import AppLayout from './components/AppLayout';
import SensorsPage from './pages/SensorsPage';
import BlackBoxPage from './pages/BlackBoxPage';
import DatasetPage from './pages/DatasetPage';
import CliPage from './pages/CliPage';

export default function App() {
  return (
    <WorkbenchProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<SensorsPage />} />
            <Route path="/blackbox" element={<BlackBoxPage />} />
            <Route path="/dataset" element={<DatasetPage />} />
            <Route path="/cli" element={<CliPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WorkbenchProvider>
  );
}
