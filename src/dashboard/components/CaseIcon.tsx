const paths = {
  back: "M20 12H4m6-6-6 6 6 6",
  previous: "m15 6-6 6 6 6",
  next: "m9 6 6 6-6 6",
  down: "M12 4v16m-6-6 6 6 6-6",
  external: "M13 5h6v6m0-6-9 9M19 13v6H5V5h6",
  reply: "m10 6-6 6 6 6m-6-6h9a6 6 0 0 1 6 6v1",
  message: "M20 6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V6ZM8 9h8m-8 3h5",
  status: "M5 7h14m-4-4 4 4-4 4M19 17H5m4-4-4 4 4 4",
  file: "M8 13l6-6a2.2 2.2 0 1 1 3.1 3.1l-8 8a4 4 0 1 1-5.7-5.7l9-9",
  flag: "M5 21V4h12l-2.5 4 2.5 4H5",
  report: "M6 3h8l4 4v14H6zM14 3v5h4m-9 4h6m-6 4h6",
  code: "m8 6-5 6 5 6m8-12 5 6-5 6m-3-15-2 18",
  chevron: "m6 9 6 6 6-6",
  check: "m5 12 4 4L19 6",
  info: "M12 16v-4m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
} as const;

export function CaseIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg class="case-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
