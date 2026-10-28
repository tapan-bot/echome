import Image from "next/image";

/**
 * EchoMe's mark: the logo, two profiles facing each other, the shared silhouette
 * between them reading as a single vessel. Echo, meeting itself.
 *
 * `animated` adds a slow breathing pulse for loading contexts; it respects
 * prefers-reduced-motion via the `echo-breathe` keyframes in globals.css.
 */
export function EchoMark({
  size = 40,
  animated = false,
}: {
  size?: number;
  animated?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt="EchoMe"
      width={size}
      height={size}
      priority
      className={animated ? "echo-breathe" : undefined}
      style={{ width: size, height: size }}
    />
  );
}
