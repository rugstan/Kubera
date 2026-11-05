import Image from "next/image";
import Link from "next/link";
import { structurePath, type DealStructure } from "@/content/deal-structures";
import { structureImage } from "@/content/images";

// Width of a card's photo in the /structures grid: one column below md, two
// from md, three from xl, in a container of 100vw less the gutters (at most 1216px).
const IMAGE_SIZES = "(min-width: 1280px) 392px, (min-width: 768px) calc(50vw - 42px), calc(100vw - 40px)";

/**
 * Card for one illustrative structure. Used on the home page and on /structures.
 * `withImage` adds the structure's photo across the top of the card; only
 * /structures asks for it, so the home page cards stay as they were.
 */
export function StructureCard({ structure: s, withImage = false }: { structure: DealStructure; withImage?: boolean }) {
  const image = withImage ? structureImage(s.slug) : null;
  return (
    <article className="bento flex h-full flex-col p-7">
      {image ? (
        <div className="-mx-7 -mt-7 mb-7 overflow-hidden rounded-t-card bg-hairline" data-structure-card-image={s.slug}>
          <Image
            src={image.src}
            alt={image.alt}
            placeholder="blur"
            sizes={IMAGE_SIZES}
            className="aspect-[4/3] h-auto w-full object-cover"
            style={image.position ? { objectPosition: image.position } : undefined}
          />
        </div>
      ) : null}
      <p className="text-4xl font-semibold">{s.amount}</p>
      <h3 className="mt-3 text-lg font-semibold">{s.asset}</h3>
      <p className="text-[15px] font-medium text-graphite">{s.program}</p>
      <p className="mt-3 text-[14px] leading-relaxed text-titanium">{s.summary}</p>
      <ul className="mt-6 flex flex-wrap gap-1.5">
        {s.tags.map((t) => (
          <li key={t} className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[12px] text-ink/70">{t}</li>
        ))}
      </ul>
      <Link href={structurePath(s.slug)} className="link-chevron mt-auto self-start pt-6 text-[14px]">
        See how it is structured<span className="sr-only">: {s.asset}, {s.program}</span>
      </Link>
    </article>
  );
}
