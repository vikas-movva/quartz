import type { QuartzFilterPlugin } from "../../../../quartz/plugins/types"

interface Options {
  /** frontmatter tag that marks a note as private */
  tag: string
}

const defaultOptions: Options = {
  tag: "private",
}

function hasPrivateTag(vfile: any, tag: string): boolean {
  const fm = vfile?.data?.frontmatter
  if (!fm) return false
  const tags = fm.tags ?? fm.tag
  if (!tags) return false
  const list = Array.isArray(tags) ? tags : String(tags).split(/[,\s]+/).filter(Boolean)
  return list.map((t: unknown) => String(t).toLowerCase()).includes(tag.toLowerCase())
}

export const FilterPrivate: QuartzFilterPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }
  return {
    name: "FilterPrivate",
    shouldPublish(_ctx: any, [_tree, vfile]: [any, any]) {
      return !hasPrivateTag(vfile, opts.tag)
    },
  }
}

export default FilterPrivate
