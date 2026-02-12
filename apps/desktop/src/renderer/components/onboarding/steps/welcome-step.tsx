/**
 * Onboarding Step 1: Welcome.
 *
 * Brief introduction to Palot and what the setup will cover.
 */

import { Button } from "@palot/ui/components/button"
import { ArrowRightIcon } from "lucide-react"
import { PalotWordmark } from "../../palot-wordmark"

interface WelcomeStepProps {
	onContinue: () => void
}

export function WelcomeStep({ onContinue }: WelcomeStepProps) {
	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			<div className="w-full max-w-md space-y-8 text-center">
				{/* Logo */}
				<div className="flex justify-center">
					<PalotWordmark className="h-6 w-auto text-foreground" />
				</div>

				{/* Description */}
				<div className="space-y-3">
					<p className="text-lg text-muted-foreground">Your desktop companion for OpenCode.</p>
					<p className="text-sm leading-relaxed text-muted-foreground/70">
						Palot gives you a native experience for managing OpenCode sessions across all your
						projects, with real-time streaming, native notifications, and multi-session support.
					</p>
				</div>

				{/* CTA */}
				<div className="space-y-3">
					<Button size="lg" onClick={onContinue} className="gap-2">
						Get Started
						<ArrowRightIcon aria-hidden="true" className="size-4" />
					</Button>
					<p className="text-xs text-muted-foreground/50">This takes less than a minute.</p>
				</div>
			</div>
		</div>
	)
}
