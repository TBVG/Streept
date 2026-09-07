import React, { useEffect, useRef, useState } from 'react';
import { Location } from '../types';
import { bearingDegrees, haversineDistanceMeters } from '../utils/geo';
import './ArOverlay.css';

interface ArOverlayProps {
  userLocation: Location;
  targetLocation: Location;
  targetLabel: string;
  onClose: () => void;
}

// iOS Safari doesn't fire useful deviceorientation events without an
// explicit permission grant, requested from a user gesture (not on page
// load) — this is why AR mode is opened via a button tap, not automatic.
type PermissionState = 'unrequested' | 'granted' | 'denied' | 'unsupported';

const ArOverlay: React.FC<ArOverlayProps> = ({ userLocation, targetLocation, targetLabel, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [orientationPermission, setOrientationPermission] = useState<PermissionState>('unrequested');
  const [headingDeg, setHeadingDeg] = useState<number | null>(null);

  // Camera feed.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      })
      .catch(() => {
        setCameraError(
          "Couldn't access the camera. This needs a phone with camera permission granted, over HTTPS."
        );
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Compass heading. Cross-browser reality here is genuinely messy:
  // - iOS Safari: needs an explicit, gesture-triggered permission request
  //   (DeviceOrientationEvent.requestPermission), then exposes heading
  //   directly as event.webkitCompassHeading (0 = north, no math needed).
  // - Most other browsers: no permission prompt, but no direct compass
  //   heading either — only event.alpha (device rotation around its own
  //   Z-axis), which approximates compass heading as (360 - alpha) when
  //   the event is flagged `absolute` (calibrated against real-world
  //   north, not just relative rotation since page load). Uncalibrated
  //   devices/browsers will drift or be simply wrong; there's no way to
  //   detect that from here.
  const requestOrientationPermission = async () => {
    const DOEAny = DeviceOrientationEvent as any;
    if (typeof DOEAny?.requestPermission === 'function') {
      try {
        const result = await DOEAny.requestPermission();
        setOrientationPermission(result === 'granted' ? 'granted' : 'denied');
      } catch {
        setOrientationPermission('denied');
      }
    } else if (typeof window.DeviceOrientationEvent !== 'undefined') {
      // No permission API (most non-iOS browsers) — assume available.
      setOrientationPermission('granted');
    } else {
      setOrientationPermission('unsupported');
    }
  };

  useEffect(() => {
    if (orientationPermission !== 'granted') return;

    const handler = (event: DeviceOrientationEvent) => {
      const webkitHeading = (event as any).webkitCompassHeading;
      if (typeof webkitHeading === 'number') {
        setHeadingDeg(webkitHeading);
      } else if (event.absolute && event.alpha !== null) {
        setHeadingDeg((360 - event.alpha) % 360);
      }
    };

    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [orientationPermission]);

  const bearingToTarget = bearingDegrees(userLocation, targetLocation);
  const distance = Math.round(haversineDistanceMeters(userLocation, targetLocation));
  // Arrow rotation: where the target is, relative to which way the phone
  // is currently facing.
  const arrowRotation = headingDeg !== null ? (bearingToTarget - headingDeg + 360) % 360 : null;

  return (
    <div className="ar-overlay">
      <video ref={videoRef} autoPlay playsInline muted className="ar-overlay-video" />

      <button className="ar-overlay-close" onClick={onClose} title="Exit AR view">
        ✕
      </button>

      {cameraError && <div className="ar-overlay-message">{cameraError}</div>}

      {!cameraError && orientationPermission === 'unrequested' && (
        <div className="ar-overlay-message">
          <p>AR view needs access to your compass to point the way.</p>
          <button onClick={requestOrientationPermission}>Enable compass</button>
        </div>
      )}

      {orientationPermission === 'denied' && (
        <div className="ar-overlay-message">
          Compass access was denied — the arrow below can't be aimed without it. Distance still updates.
        </div>
      )}

      {orientationPermission === 'unsupported' && (
        <div className="ar-overlay-message">
          This browser/device doesn't support compass heading — AR direction isn't available here.
        </div>
      )}

      {!cameraError && orientationPermission === 'granted' && (
        <>
          <div
            className="ar-overlay-arrow"
            style={{ transform: arrowRotation !== null ? `rotate(${arrowRotation}deg)` : undefined }}
          >
            ▲
          </div>
          <div className="ar-overlay-info">
            <p className="ar-overlay-distance">{distance} m</p>
            <p className="ar-overlay-label">{targetLabel}</p>
          </div>
        </>
      )}

      <div className="ar-overlay-disclaimer">
        Compass-guided, not anchored to the road — this points toward the turn, it doesn't paint directions onto
        the street itself.
      </div>
    </div>
  );
};

export default ArOverlay;
