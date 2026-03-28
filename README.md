<p align="center">
  <a href="https://rescile.com" target="_blank" rel="noopener">
    <img width="280" src="https://www.rescile.com/images/logos/rescile_logo.svg" alt="rescile logo">
  </a>
</p>

<h1 align="center">rescile: Hybrid Cloud Controller</h1>

<p align="center">
  <strong>From Complexity to Clarity — Build a Living Blueprint of Your Hybrid World.</strong>
  <br><br>
  This repository contains the source for <a href="https://rescile.com">rescile.com</a>, including comprehensive documentation and real-world examples for modeling, governing, and automating your hybrid cloud.
</p>

## What is rescile?

rescile transforms scattered data from your hybrid environment into a single, queryable dependency graph. It creates a "digital twin" of your entire estate, allowing you to go from fragmented data to decisive answers.

With rescile, you can:

- **Generate Complete Deployment Recipes** for Terraform, Ansible, and Kubernetes.
- **Automate Audits** with compliance-as-code for SOX, GDPR, DORA, and more.
- **Achieve True FinOps Cost Attribution** by connecting technical assets to business owners.
- **Proactively Manage Risk** by tracing vulnerabilities from an SBOM to every affected application.
- **Enforce Architectural Standards** and validate your deployed reality against your blueprint.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for bugs, feature requests, or suggestions.

---

<p align="center">
  Built with ❤️ by the team at <a href="https://rescile.com">rescile.com</a>
</p>

---

# rescile-ce Project Initialization

This repository contains scripts to automatically download, verify, and install the `rescile-ce` command-line tool into a local `.rescile/.bin/` directory.

The scripts are idempotent: if the correct binary is already installed, they will simply ensure its location is added to your `PATH` without re-downloading.

The recommended method for managing this local environment is [direnv](https://direnv.net/), which automates the setup process whenever you enter the project directory.

## Prerequisites

- **`direnv` (Recommended)**: A shell extension to load and unload environment variables depending on the current directory.
- **Linux/macOS**: `curl` and `jq` are required for the manual setup scripts.
- **Windows**: `PowerShell 5.1+` and `curl` (included in modern Windows 10/11) are required.
- **NixOS**: If you are using NixOS, ensure `programs.nix-ld.enable = true` is set in your system configuration.

---

## Recommended Method: `direnv`

Using `direnv` is the most convenient way to manage the `rescile-ce` tool. Once configured, it will be automatically available in your `PATH` every time you `cd` into this directory.

This project already contains a `.envrc` file, so you only need to install `direnv` and allow it to run.

**1. Install `direnv`**

Follow the [official installation instructions](https://direnv.net/docs/installation.html) for your operating system. For example, on macOS with Homebrew:

```sh
brew install direnv
```

**2. Hook `direnv` into your shell**

You must add a "hook" to your shell's startup file. This only needs to be done once. Choose the command for your shell:

*   **Bash** (`~/.bashrc`):

    ```sh
    echo 'eval "$(direnv hook bash)"' >> ~/.bashrc
    ```
*   **Zsh** (`~/.zshrc`):

    ```sh
    echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
    ```
*   **Fish** (`~/.config/fish/config.fish`):

    ```sh
    echo 'direnv hook fish | source' >> ~/.config/fish/config.fish
    ```

**Restart your shell** for the changes to take effect.

**3. Allow the project environment**

Navigate to the project directory and allow `direnv` to execute the `.envrc` file:

```sh
cd /path/to/your/project
direnv allow
```
The first time you do this, `direnv` will run the `init.sh` script, which will download `rescile-ce`. On subsequent visits to the directory, `direnv` will simply and quickly add the tool to your `PATH`.

You can now run `rescile-ce` directly:

```sh
rescile-ce --version
```

---

## Manual Setup

If you prefer not to use `direnv`, you can run the initialization scripts manually. This will configure your **current shell session only**.

### Linux & macOS (bash, zsh)

The `init.sh` script must be evaluated by your shell so it can modify your environment.

```sh
eval "$(./.rescile/scripts/init.sh)"
```
After running this, the `rescile-ce` command will be available in your terminal.

### Windows (PowerShell)

Using PowerShell is the recommended manual method on Windows.

1.  First, you may need to adjust your execution policy to allow local scripts to run. This command affects the current process only.

    ```powershell
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
    ```
2.  Then, run the initialization script:

    ```powershell
    .\.rescile\scripts\init.ps1
    ```

### Windows (Command Prompt)

If you are using the legacy Command Prompt (`cmd.exe`), you can use the provided batch script.

```cmd
.\.rescile\scripts\init.bat
```

## How It Works

The initialization scripts perform the following actions:

1.  Check if `rescile-ce` is already present in the local `./.rescile/.bin` directory.
2.  If not, they detect your operating system and CPU architecture.
3.  They fetch metadata from `https://updates.rescile.com/index.json` to find the URL and SHA256 checksum for the latest release that matches your platform.
4.  The binary is downloaded into the `./.rescile/.bin` directory.
5.  The checksum of the downloaded file is verified against the expected checksum to ensure integrity.
6.  Finally, the `./.rescile/.bin` directory is prepended to your shell's `PATH` environment variable for the current session.

