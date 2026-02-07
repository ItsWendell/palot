import { Button } from "@codedeck/ui/components/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@codedeck/ui/components/dialog"
import { Input } from "@codedeck/ui/components/input"
import { Label } from "@codedeck/ui/components/label"
import { Loader2Icon, ServerIcon } from "lucide-react"
import { useState } from "react"

interface ConnectServerDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConnect: (url: string, directory: string) => Promise<void>
}

export function ConnectServerDialog({ open, onOpenChange, onConnect }: ConnectServerDialogProps) {
	const [url, setUrl] = useState("http://localhost:4096")
	const [directory, setDirectory] = useState("")
	const [connecting, setConnecting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function handleConnect() {
		setConnecting(true)
		setError(null)
		try {
			await onConnect(url.trim(), directory.trim() || url.trim())
			onOpenChange(false)
			setUrl("http://localhost:4096")
			setDirectory("")
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to connect")
		} finally {
			setConnecting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[440px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<ServerIcon className="size-4" />
						Connect to OpenCode Server
					</DialogTitle>
					<DialogDescription>
						Connect to a running OpenCode server to manage its sessions.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div className="space-y-2">
						<Label htmlFor="server-url">Server URL</Label>
						<Input
							id="server-url"
							placeholder="http://localhost:4096"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && url.trim()) handleConnect()
							}}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="server-dir">Project Directory (optional)</Label>
						<Input
							id="server-dir"
							placeholder="/path/to/project"
							value={directory}
							onChange={(e) => setDirectory(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							The project directory this server manages. Used for display.
						</p>
					</div>

					{error && (
						<div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
							{error}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleConnect} disabled={!url.trim() || connecting}>
						{connecting ? (
							<>
								<Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
								Connecting...
							</>
						) : (
							"Connect"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
