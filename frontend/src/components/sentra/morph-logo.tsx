"use client"

import { AssistantMark } from "@/components/assistant/assistant-avatar"

/**
 * Sentra's logo that turns into the living orb. It is for the public landing page (the logo in its
 * header): it rests as the logo, the cobalt rounded square with the shield and check. When the
 * cursor comes near it, or touches it, the square turns into the white and blue orb, the shield
 * melts into two eyes that follow the cursor, and it turns back when the cursor leaves. Touched
 * again and again it gets angry, held for a while it falls in love, and so on: the same feelings
 * as the assistant (see assistant-avatar.tsx).
 *
 * Inside the product the assistant is always the orb and never the logo, so this component is not
 * used there. Put it where the landing page draws its logo:
 *
 *     <MorphLogo size={36} />
 *
 * It is decoration (`aria-hidden`): give the link around it its own name, as "Sentra home" now.
 */
export function MorphLogo({ size = 36, className }: { size?: number; className?: string }) {
  return <AssistantMark size={size} rest="logo" className={className} />
}
