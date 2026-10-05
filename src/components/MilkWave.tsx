export default function MilkWave({
  direction = "down",
  loader = false,
}: {
  direction?: "up" | "down";
  loader?: boolean;
}) {
  return (
    <div
      className={`milk-wave ${direction} ${loader ? "loader-wave" : ""}`}
      aria-hidden="true"
    >
      {["#EAF1FF", "#FFFFFF"].map((fill, i) => (
        <div key={fill} className={`milk-layer milk-layer-${i}`}>
          <svg viewBox="0 0 1440 3000" preserveAspectRatio="none">
            <path
              fill={fill}
              d="M0 120 Q90 10 180 95 T360 90 Q450 150 500 60 Q550 -10 620 90 Q700 165 785 65 Q865 -10 950 95 T1120 75 Q1190 15 1260 100 T1440 80 V3000 H0Z"
            />
            <g fill={fill}>
              <ellipse cx="185" cy="42" rx="20" ry="30" />
              <ellipse cx="460" cy="28" rx="13" ry="24" />
              <ellipse cx="770" cy="17" rx="17" ry="26" />
              <ellipse cx="1120" cy="23" rx="23" ry="35" />
              <ellipse cx="1340" cy="25" rx="13" ry="20" />
            </g>
          </svg>
        </div>
      ))}
    </div>
  );
}
