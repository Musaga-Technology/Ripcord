// Ripcord's mark in its small form: the seal's outer ring and a seven-lobed amber rosette, which reads at 16–32 px where
// the full guilloche seal (the avatar) would blur. The outer ring takes the text colour; the core is always amber.
export function SealMark({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="9.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M11.0 5.1L11.4 5.2L11.8 5.6L12.1 6.0L12.4 6.5L12.6 6.9L12.9 7.1L13.2 7.2L13.6 7.1L14.2 7.0L14.7 7.0L15.3 7.1L15.6 7.3L15.8 7.7L15.8 8.2L15.6 8.8L15.4 9.3L15.2 9.7L15.2 10.0L15.3 10.3L15.7 10.6L16.1 11.0L16.5 11.4L16.7 11.9L16.8 12.3L16.5 12.7L16.1 13.0L15.6 13.2L15.1 13.3L14.6 13.5L14.3 13.7L14.2 14.0L14.2 14.4L14.2 15.0L14.1 15.6L13.9 16.0L13.6 16.3L13.1 16.4L12.6 16.3L12.1 16.0L11.7 15.6L11.3 15.4L11.0 15.3L10.7 15.4L10.3 15.6L9.9 16.0L9.4 16.3L8.9 16.4L8.4 16.3L8.1 16.0L7.9 15.6L7.8 15.0L7.8 14.4L7.8 14.0L7.7 13.7L7.4 13.5L6.9 13.3L6.4 13.2L5.9 13.0L5.5 12.7L5.2 12.3L5.3 11.9L5.5 11.4L5.9 11.0L6.3 10.6L6.7 10.3L6.8 10.0L6.8 9.7L6.6 9.3L6.4 8.8L6.2 8.2L6.2 7.7L6.4 7.3L6.7 7.1L7.3 7.0L7.8 7.0L8.4 7.1L8.8 7.2L9.1 7.1L9.4 6.9L9.6 6.5L9.9 6.0L10.2 5.6L10.6 5.2Z"
        stroke="var(--amber)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
