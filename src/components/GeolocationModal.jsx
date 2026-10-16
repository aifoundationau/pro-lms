import React, { useEffect, useState } from 'react';
import { requestBrowserGps, fetchWeather } from '../services/geolocationWeatherService.js';

export default function GeolocationModal({
  isOpen,
  onClose,
  location,
  weather,
  onLocationUpdate
}) {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [isUpdatingGps, setIsUpdatingGps] = useState(false);
  const [gpsMessage, setGpsMessage] = useState('');

  // Live ticking clock every second
  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  // Escape key light-dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRequestGps = async () => {
    setIsUpdatingGps(true);
    setGpsMessage('');
    try {
      const newLoc = await requestBrowserGps();
      if (newLoc) {
        const newWeather = await fetchWeather(newLoc.latitude, newLoc.longitude);
        if (onLocationUpdate) {
          onLocationUpdate(newLoc, newWeather);
        }
        setGpsMessage('Updated from GPS!');
      } else {
        setGpsMessage('Location access unavailable or declined.');
      }
    } catch {
      setGpsMessage('Could not retrieve GPS coordinates.');
    } finally {
      setIsUpdatingGps(false);
      setTimeout(() => setGpsMessage(''), 3500);
    }
  };

  const formattedTime = currentTime.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const formattedDate = currentTime.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Brisbane';

  const lat = location?.latitude ?? -27.4748;
  const lon = location?.longitude ?? 153.0180;
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="geo-modal-title"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(5, 15, 10, 0.78)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        padding: '16px',
        boxSizing: 'border-box'
      }}
    >
      <div
        className="glass modal-content animate-fade-in-up geo-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '470px',
          maxHeight: '94vh',
          overflow: 'hidden', // Strictly no scroll bars
          boxSizing: 'border-box',
          padding: '24px 26px',
          borderRadius: '22px',
          background: 'rgba(10, 31, 22, 0.96)',
          border: '1px solid rgba(52, 211, 153, 0.35)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.65), 0 0 30px rgba(52, 211, 153, 0.1)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        {/* Close Button */}
        <button
          type="button"
          className="close-btn"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            color: '#94a3b8',
            fontSize: '1.25rem',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            transition: 'all 0.2s ease'
          }}
        >
          ✕
        </button>

        {/* Modal Header */}
        <div style={{ paddingRight: '36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '1.35rem' }}>🏛️</span>
            <h2 id="geo-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: '#fef08a', fontWeight: '700' }}>
              AI Foundation Australia
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
            Regional Geolocation, Weather & Live Local Telemetry
          </p>
        </div>

        {/* Live Clock Card */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(6, 78, 59, 0.28) 100%)',
            border: '1px solid rgba(52, 211, 153, 0.3)',
            borderRadius: '16px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '2px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#34d399',
                  boxShadow: '0 0 8px #34d399',
                  display: 'inline-block'
                }}
              />
              <span style={{ fontSize: '0.72rem', color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                Live Time
              </span>
            </div>
            <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#ffffff', letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {formattedTime}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>
              {formattedDate}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
              {timeZoneName}
            </div>
          </div>
        </div>

        {/* 2-Column Grid: Suburb & Weather */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px'
          }}
        >
          {/* Suburb & Location Card */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '14px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontSize: '0.72rem', color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '4px' }}>
                📍 Suburb / Area
              </div>
              <div style={{ fontSize: '1.18rem', fontWeight: 800, color: '#fef08a', lineHeight: 1.25, wordBreak: 'break-word' }}>
                {location?.suburb || 'South Bank'}
              </div>
              <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: '4px' }}>
                {location?.city || 'Brisbane'}, {location?.state || 'Queensland'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                {location?.country || 'Australia'} 🇦🇺
              </div>
            </div>
            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', fontSize: '0.68rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
              {latStr}, {lonStr}
            </div>
          </div>

          {/* Weather Card */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '14px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontSize: '0.72rem', color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '4px' }}>
                🌤️ Local Weather
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>{weather?.icon || '☀️'}</span>
                <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#ffffff' }}>
                  {typeof weather?.temperature === 'number' ? `${weather.temperature}°C` : '24°C'}
                </span>
              </div>
              <div style={{ fontSize: '0.84rem', color: '#f1f5f9', fontWeight: 600, marginTop: '4px' }}>
                {weather?.condition || 'Clear & Sunny'}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                Feels like {weather?.apparentTemperature ?? weather?.temperature ?? 24}°C
              </div>
            </div>
            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#94a3b8' }}>
              <span>💧 {weather?.humidity ?? 62}%</span>
              <span>💨 {weather?.windSpeed ?? 14} km/h</span>
            </div>
          </div>
        </div>

        {/* Footer info & actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: '2px' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
            Source: <span style={{ color: '#94a3b8' }}>{location?.source || 'AI Foundation HQ'}</span>
            {gpsMessage && <span style={{ color: '#34d399', marginLeft: '6px' }}>• {gpsMessage}</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="nav-btn secondary"
              onClick={handleRequestGps}
              disabled={isUpdatingGps}
              style={{
                padding: '4px 12px',
                fontSize: '0.75rem',
                borderRadius: '16px',
                cursor: 'pointer'
              }}
              title="Detect precise GPS location from your device"
            >
              {isUpdatingGps ? 'Locating...' : '🛰️ Exact GPS'}
            </button>
            <button
              type="button"
              className="nav-btn primary"
              onClick={onClose}
              style={{
                padding: '4px 14px',
                fontSize: '0.75rem',
                borderRadius: '16px',
                cursor: 'pointer'
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
