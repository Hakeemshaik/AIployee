export default function Loading() {
  return (
    <div className="page-in">
      <div className="skeleton mb-6 h-7 w-56" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-[88px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="skeleton h-[320px]" />
        <div className="skeleton h-[320px]" />
      </div>
    </div>
  );
}
