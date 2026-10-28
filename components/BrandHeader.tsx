/** The band across the top of the chat. The logo and name themselves are fixed on every page
    (components/SiteBrand.tsx); this only gives the chat its header line and leaves room for them. */
export function BrandHeader({ trailing }: { trailing?: React.ReactNode }) {
  return (
    <header className="flex h-[3.75rem] items-center justify-end border-b border-line pl-4 pr-16">
      {trailing}
    </header>
  );
}
