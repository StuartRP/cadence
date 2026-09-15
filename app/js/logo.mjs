// Top-bar logo: hovering slides the "<>" apart to reveal the version number;
// clicking it pins the version so it stays after the pointer leaves.

const HOVER_DELAY = 700

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")

const versionOf = () => String(window.code?.version ?? "").trim()

// Writes the version to the reveal. Falls back to window.code.version (the
// app holds both its own default and the /version.json value there); an
// explicit value wins so a direct fetch can fill in fast.
const setVersion = (logo, explicit) => {
	const major = logo.querySelector(".logo-version .major")
	const tail = logo.querySelector(".logo-version .tail")
	if (!(major && tail)) return
	const str = String(explicit ?? versionOf()).trim()
	const dot = str.indexOf(".")
	if (dot > 0) {
		major.textContent = str.slice(0, dot)
		tail.textContent = str.slice(dot)
	} else {
		major.textContent = str
		tail.textContent = ""
	}
}

const initLogo = () => {
	const logo = document.getElementById("logo")
	if (!logo) return

	setVersion(logo)
	fetch("/version.json")
		.then((response) => (response.ok ? response.json() : null))
		.then((data) => {
			if (data?.version) setVersion(logo, data.version)
		})
		.catch(() => {})

	let hoverTimer = null
	let pinned = false

	const isOpen = () => logo.classList.contains("open")
	const setState = (open) => {
		if (open) setVersion(logo)
		logo.classList.toggle("open", open)
		logo.setAttribute("aria-expanded", open ? "true" : "false")
	}

	logo.addEventListener("pointerenter", () => {
		clearTimeout(hoverTimer)
		if (pinned || isOpen()) return
		hoverTimer = setTimeout(() => setState(true), reduceMotion.matches ? 0 : HOVER_DELAY)
	})

	logo.addEventListener("pointerleave", () => {
		clearTimeout(hoverTimer)
		if (!pinned) setState(false)
	})

	logo.addEventListener("click", () => {
		if (isOpen()) {
			pinned = !pinned
			if (!pinned) setState(false)
		} else {
			pinned = true
			setState(true)
		}
	})

	logo.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault()
			logo.click()
		}
	})
}

initLogo()