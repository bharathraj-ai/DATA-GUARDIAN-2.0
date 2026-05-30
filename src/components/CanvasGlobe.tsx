'use client';

import React, { useEffect, useRef } from 'react';

// Continent coordinates defined by latitude (Y: -90 to 90) and longitude (X: -180 to 180)
// India is at center-right in Eurasia: ~70 to 90 East, 8 to 35 North
const landmasses = {
  eurasia: [
    { lon: -9, lat: 38 }, // Spain
    { lon: -2, lat: 50 }, // France
    { lon: 10, lat: 54 }, // Denmark
    { lon: 20, lat: 60 }, // Baltic
    { lon: 30, lat: 70 }, // Northern Norway
    { lon: 60, lat: 75 }, // Siberia West
    { lon: 100, lat: 76 }, // Siberia Middle
    { lon: 140, lat: 72 }, // Siberia East
    { lon: 170, lat: 66 }, // Chukotka
    { lon: 160, lat: 55 }, // Kamchatka
    { lon: 140, lat: 50 }, // Sakhalin
    { lon: 130, lat: 40 }, // Korea
    { lon: 120, lat: 30 }, // China East
    { lon: 110, lat: 20 }, // Vietnam
    { lon: 100, lat: 10 }, // Malaya
    { lon: 95, lat: 5 },   // Sumatra tip
    { lon: 90, lat: 15 },  // Bay of Bengal East
    
    // INDIA PENINSULA
    { lon: 88, lat: 22 },  // Kolkata
    { lon: 80, lat: 13 },  // Chennai
    { lon: 78, lat: 8 },   // Kanyakumari (Southern Tip of India)
    { lon: 73, lat: 15 },  // Goa
    { lon: 72, lat: 20 },  // Mumbai
    { lon: 68, lat: 24 },  // Karachi / Gujarat
    
    { lon: 60, lat: 25 },  // Persian Gulf
    { lon: 45, lat: 15 },  // Yemen / Arabia
    { lon: 35, lat: 30 },  // Sinai
    { lon: 26, lat: 40 },  // Turkey
    { lon: 15, lat: 40 },  // Italy
    { lon: 5, lat: 43 },   // France South
    { lon: -9, lat: 38 }   // Close loop
  ],
  africa: [
    { lon: 32, lat: 31 },  // Egypt
    { lon: 45, lat: 13 },  // Horn of Africa West
    { lon: 51, lat: 10 },  // Somalia Tip
    { lon: 40, lat: -5 },  // East Coast
    { lon: 33, lat: -27 }, // Maputo
    { lon: 20, lat: -34 }, // Cape Town
    { lon: 12, lat: -15 }, // Angola
    { lon: 8, lat: 4 },    // Nigeria
    { lon: -15, lat: 12 }, // Senegal
    { lon: -10, lat: 30 }, // Morocco
    { lon: 10, lat: 37 },  // Tunisia
    { lon: 25, lat: 32 },  // Libya
    { lon: 32, lat: 31 }   // Close loop
  ],
  australia: [
    { lon: 114, lat: -22 },
    { lon: 125, lat: -15 },
    { lon: 138, lat: -12 },
    { lon: 143, lat: -10 },
    { lon: 151, lat: -23 },
    { lon: 153, lat: -28 },
    { lon: 150, lat: -35 },
    { lon: 140, lat: -37 },
    { lon: 115, lat: -33 },
    { lon: 113, lat: -28 },
    { lon: 114, lat: -22 }
  ],
  northAmerica: [
    { lon: -168, lat: 65 }, // Alaska West
    { lon: -150, lat: 70 }, // Alaska North
    { lon: -120, lat: 68 }, // Canada North
    { lon: -80, lat: 60 },  // Hudson Bay
    { lon: -60, lat: 50 },  // Labrador
    { lon: -70, lat: 43 },  // Boston
    { lon: -80, lat: 25 },  // Florida
    { lon: -97, lat: 22 },  // Gulf of Mexico
    { lon: -104, lat: 16 }, // Mexico South
    { lon: -115, lat: 30 }, // Baja California
    { lon: -125, lat: 48 }, // Seattle
    { lon: -140, lat: 60 }, // Alaska South
    { lon: -168, lat: 65 }
  ],
  southAmerica: [
    { lon: -80, lat: 8 },   // Panama
    { lon: -60, lat: 10 },  // Venezuela
    { lon: -35, lat: -5 },  // Brazil East
    { lon: -60, lat: -40 }, // Argentina
    { lon: -70, lat: -55 }, // Tierra del Fuego
    { lon: -75, lat: -40 }, // Chile
    { lon: -80, lat: -20 }, // Peru
    { lon: -81, lat: -5 },  // Ecuador
    { lon: -80, lat: 8 }
  ],
  greenland: [
    { lon: -50, lat: 60 },
    { lon: -30, lat: 70 },
    { lon: -20, lat: 80 },
    { lon: -60, lat: 82 },
    { lon: -55, lat: 70 },
    { lon: -50, lat: 60 }
  ]
};

// Target Indian subcontinent coordinates for connections
const indiaLocation = { lon: 78, lat: 20 };

export default function CanvasGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = 500;
    let height = 500;
    const radius = 170;
    const centerX = width / 2;
    const centerY = height / 2;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width || 500;
      height = rect.height || 500;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    // Initial Angle: India is at 78° East.
    // To make it face the user directly at the start:
    // The screen face corresponds to an angle of 0.
    // Since positive X is right and positive Z is front, 
    // we want 78° East to align with the camera facing direction.
    // We adjust starting angle to -Math.PI / 2.5 (approx -78 degrees in radians).
    let rotationAngle = -78 * (Math.PI / 180);
    const rotationSpeed = 0.0035; // Majestic horizontal rotation

    // Camera perspective distance
    const cameraDistance = 450;

    // Helper: Convert Lat/Lon to 3D Sphere Coordinates
    const latLonTo3D = (lat: number, lon: number) => {
      const radLat = lat * (Math.PI / 180);
      const radLon = lon * (Math.PI / 180);
      return {
        x: radius * Math.cos(radLat) * Math.sin(radLon),
        y: -radius * Math.sin(radLat), // Canvas Y goes down, Lat goes up
        z: radius * Math.cos(radLat) * Math.cos(radLon),
      };
    };

    // Helper: Project 3D space to 2D screen space
    const project = (x3d: number, y3d: number, z3d: number, currentAngle: number) => {
      // Rotate around the Y-axis (Horizontal Clockwise Rotation)
      // Clockwise rotation (looking from top) moves points from East to West (right to left on screen)
      const cosR = Math.cos(currentAngle);
      const sinR = Math.sin(currentAngle);
      
      const rx = x3d * cosR + z3d * sinR;
      const rz = -x3d * sinR + z3d * cosR;

      const scale = cameraDistance / (cameraDistance + rz);
      return {
        x: centerX + rx * scale,
        y: centerY + y3d * scale,
        z: rz,
        scale,
      };
    };

    // Dynamic network connection points (representing glowing target nodes on landmasses)
    const cities = [
      { name: 'New Delhi', lat: 28.6, lon: 77.2 },
      { name: 'Mumbai', lat: 19.0, lon: 72.8 },
      { name: 'London', lat: 51.5, lon: -0.1 },
      { name: 'New York', lat: 40.7, lon: -74.0 },
      { name: 'Tokyo', lat: 35.6, lon: 139.6 },
      { name: 'Sydney', lat: -33.8, lon: 151.2 },
      { name: 'Cape Town', lat: -33.9, lon: 18.4 },
      { name: 'Cairo', lat: 30.0, lon: 31.2 },
      { name: 'Rio de Janeiro', lat: -22.9, lon: -43.1 },
      { name: 'Singapore', lat: 1.3, lon: 103.8 }
    ];

    // Connection arcs
    const connections = [
      { from: 0, to: 2, progress: 0.0, speed: 0.008 }, // Delhi - London
      { from: 1, to: 4, progress: 0.3, speed: 0.010 }, // Mumbai - Tokyo
      { from: 0, to: 9, progress: 0.6, speed: 0.012 }, // Delhi - Singapore
      { from: 2, to: 3, progress: 0.1, speed: 0.007 }, // London - New York
      { from: 3, to: 8, progress: 0.4, speed: 0.009 }, // New York - Rio
      { from: 5, to: 4, progress: 0.7, speed: 0.011 }, // Sydney - Tokyo
      { from: 6, to: 7, progress: 0.2, speed: 0.013 }, // Cape Town - Cairo
      { from: 7, to: 0, progress: 0.5, speed: 0.008 }  // Cairo - Delhi
    ];

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      // 1. Draw glowing ambient atmosphere/background
      const radialGlow = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radius * 1.4
      );
      radialGlow.addColorStop(0, 'rgba(56, 189, 248, 0.06)');
      radialGlow.addColorStop(0.6, 'rgba(2, 132, 199, 0.02)');
      radialGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = radialGlow;
      ctx.fillRect(0, 0, width, height);

      // Slow majestic horizontal rotation
      rotationAngle += rotationSpeed;

      // Draw sphere outline / atmosphere edge
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(56, 189, 248, 0.5)';
      ctx.stroke();
      ctx.shadowBlur = 0; // reset shadow

      // 2. Draw Grid Lines (Latitude/Longitude parallels)
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.07)';

      // Latitude lines (Parallels)
      for (let lat = -60; lat <= 60; lat += 20) {
        ctx.beginPath();
        for (let lon = -180; lon <= 180; lon += 5) {
          const pt3d = latLonTo3D(lat, lon);
          const pt2d = project(pt3d.x, pt3d.y, pt3d.z, rotationAngle);
          
          if (pt2d.z < 20) { // Only draw lines on the front-facing hemisphere
            if (lon === -180) ctx.moveTo(pt2d.x, pt2d.y);
            else ctx.lineTo(pt2d.x, pt2d.y);
          }
        }
        ctx.stroke();
      }

      // Longitude lines (Meridians)
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        for (let lat = -80; lat <= 80; lat += 5) {
          const pt3d = latLonTo3D(lat, lon);
          const pt2d = project(pt3d.x, pt3d.y, pt3d.z, rotationAngle);
          
          if (pt2d.z < 20) {
            if (lat === -80) ctx.moveTo(pt2d.x, pt2d.y);
            else ctx.lineTo(pt2d.x, pt2d.y);
          }
        }
        ctx.stroke();
      }

      // 3. Draw Continents (Landmass Outline & Glowing Fill)
      Object.entries(landmasses).forEach(([name, coords]) => {
        // Project all polygon vertices
        const points = coords.map((c) => {
          const pt3d = latLonTo3D(c.lat, c.lon);
          return project(pt3d.x, pt3d.y, pt3d.z, rotationAngle);
        });

        // Split drawing into contiguous front-facing segments
        ctx.beginPath();
        let drawing = false;

        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (p.z < 10) { // Vertex is in the front hemisphere
            if (!drawing) {
              ctx.moveTo(p.x, p.y);
              drawing = true;
            } else {
              ctx.lineTo(p.x, p.y);
            }
          } else {
            drawing = false;
          }
        }

        // Style the continents
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = 1.25;
        ctx.stroke();

        // Semi-transparent glowing fill for front-facing land
        ctx.fillStyle = 'rgba(56, 189, 248, 0.03)';
        ctx.fill();
      });

      // 4. Draw Glowing City Nodes
      const projectedCities = cities.map((city) => {
        const pt3d = latLonTo3D(city.lat, city.lon);
        return {
          ...city,
          ...project(pt3d.x, pt3d.y, pt3d.z, rotationAngle)
        };
      });

      projectedCities.forEach((city) => {
        if (city.z < 0) { // city is on the front side
          const opacity = Math.max(0.2, (cameraDistance - city.z) / cameraDistance);
          
          // Draw outer glow ring
          ctx.beginPath();
          ctx.arc(city.x, city.y, 4, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(56, 189, 248, ${opacity * 0.4})`;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Draw solid inner dot
          ctx.beginPath();
          ctx.arc(city.x, city.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(56, 189, 248, ${opacity})`;
          ctx.fill();
        }
      });

      // 5. Draw Traveling Data Packets (Network Connections)
      connections.forEach((conn) => {
        conn.progress += conn.speed;
        if (conn.progress >= 1) conn.progress = 0;

        const fromCity = projectedCities[conn.from];
        const toCity = projectedCities[conn.to];

        // Draw connections only if both cities are facing the user
        if (fromCity.z < 10 && toCity.z < 10) {
          const midX = (fromCity.x + toCity.x) / 2;
          const midY = (fromCity.y + toCity.y) / 2 - Math.abs(fromCity.x - toCity.x) * 0.15; // Bend upwards

          // Draw the static connecting arc line
          ctx.beginPath();
          ctx.moveTo(fromCity.x, fromCity.y);
          ctx.quadraticCurveTo(midX, midY, toCity.x, toCity.y);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
          ctx.lineWidth = 0.8;
          ctx.stroke();

          // Draw the pulsing packet along the curve
          const t = conn.progress;
          const px = (1 - t) * (1 - t) * fromCity.x + 2 * (1 - t) * t * midX + t * t * toCity.x;
          const py = (1 - t) * (1 - t) * fromCity.y + 2 * (1 - t) * t * midY + t * t * toCity.y;

          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fillStyle = '#38bdf8';
          ctx.shadowBlur = 6;
          ctx.shadowColor = '#38bdf8';
          ctx.fill();
          ctx.shadowBlur = 0; // reset
        }
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas 
        ref={canvasRef} 
        style={{ width: '420px', height: '420px', display: 'block', maxWidth: '100%' }}
      />
    </div>
  );
}
