/**
 * StatsCard Component
 * 
 * Compact statistics display card for the editor stats row.
 * Memoized to prevent re-renders when other stats change.
 *
 * @module pdf/ui/StatsCard
 */

import { memo } from "react";

/**
 * @param {Object} props
 * @param {string} props.icon
 * @param {string} props.label
 * @param {string|number} props.value
 * @param {string} [props.accent]
 */
const StatsCard = memo(function StatsCard({ icon, label, value, accent }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", border: "1px solid #e4e9f5", boxShadow: "0 2px 8px rgba(35,71,160,0.06)" }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || "#2347a0", fontFamily: "'Playfair Display', serif", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8896b0", marginTop: 3, fontWeight: 500 }}>{label}</div>
    </div>
  );
});

export default StatsCard;
