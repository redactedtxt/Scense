# Scense deploy runbook (manual setup before M6)

Everything here is done by hand in the AWS console, your domain registrar, GitHub, and a PowerShell window on your laptop. M6 code (the prod compose file, the deploy workflow, the backup job) comes after you finish.

**Markers**

- 💾 **SAVE**: write this value down for later. It is not a secret, so a notes file is fine.
- 🔒 **SECRET**: put this in your password manager and in GitHub only. Never paste it into chat, a commit, an issue, or a screenshot.

**Before you start**

- Sign in to the AWS console as an IAM user or SSO user with admin rights, not the root user. The root user should have MFA on.
- Open your password manager.
- Commands marked **PowerShell** run on your laptop. Commands marked **server** run inside the SSH session on EC2.
- Rough cost: t3.small about US$17 a month, 20 GB gp3 about US$2, the public IPv4 address about US$3.65, S3 a few cents. Check Billing to see whether free-plan credits cover any of it.

---

## Part A: AWS console

### A1. Region

1. In the top-right of the AWS console, click the region name and choose **Canada (Central) ca-central-1**. Check it still says Canada (Central) before every step below. Key pairs, security groups, and instances only exist in the region you create them in.

### A2. Budget alarm (optional, recommended)

2. Search bar → **Billing and Cost Management** → left menu **Budgets** → **Create budget**.
3. Choose **Use a template (simplified)** → **Monthly cost budget**.
4. Budget name `scense-monthly`, amount `30` (USD), email recipients: your email. Click **Create budget**.

### A3. SSH key pair (your personal admin key)

5. Search bar → **EC2** → left menu **Network & Security** → **Key Pairs** → **Create key pair**.
6. Name `ScenseKeyPair`, key pair type **ED25519**, private key file format **.pem**. Click **Create key pair**. The browser downloads `ScenseKeyPair.pem`. AWS keeps no copy, so if you lose this file you lose this key.
7. **PowerShell:** move the key into your `.ssh` folder and lock its permissions so OpenSSH accepts it:

   ```powershell
   New-Item -ItemType Directory -Force "$HOME\.ssh" | Out-Null
   Move-Item "$HOME\Downloads\ScenseKeyPair.pem" "$HOME\.ssh\ScenseKeyPair.pem"
   icacls "$HOME\.ssh\ScenseKeyPair.pem" /inheritance:r /grant:r "$($env:USERNAME):R"
   ```

   💾 **SAVE:** the key lives at `C:\Users\ViZi0\.ssh\ScenseKeyPair.pem`. Back it up in your password manager as a file attachment.

### A4. Security group (the firewall)

8. EC2 → left menu **Network & Security** → **Security Groups** → **Create security group**.
9. Security group name `scense-web-sg`. Description `Scense prod: SSH, HTTP, HTTPS`. VPC: leave the default VPC.
10. Under **Inbound rules**, click **Add rule** four times and fill in:

    | Type | Protocol | Port | Source | Description |
    |---|---|---|---|---|
    | SSH | TCP | 22 | Anywhere-IPv4 (`0.0.0.0/0`) | SSH, key only |
    | HTTP | TCP | 80 | Anywhere-IPv4 | Let's Encrypt + redirect |
    | HTTPS | TCP | 443 | Anywhere-IPv4 | Site |
    | Custom UDP | UDP | 443 | Anywhere-IPv4 | HTTP/3 (Caddy) |

    Why SSH is open to everyone: GitHub Actions connects from addresses that change on every run, so a "My IP" rule would block the deploy. The server only accepts key logins (Ubuntu turns password login off, and step 46 checks that), so an open port 22 lets people knock but not get in. The AWS console will show a warning about this rule. That's expected.

11. Leave **Outbound rules** as they are (all traffic). Click **Create security group**.

### A5. S3 bucket for backups

12. Search bar → **S3** → **Create bucket**.
13. Bucket type **General purpose**. Check that the region shown at the top of the page is **Canada (Central) ca-central-1**.
14. Bucket name: `scense-backups-` plus something unique, such as your initials and a number (for example `scense-backups-ts-1016`). Lowercase letters, numbers, and hyphens only. Bucket names are global across all AWS accounts, so if the name is taken, try another.

    💾 **SAVE:** the bucket name. It goes into the `AWS_BACKUP_BUCKET` secret and the IAM policy.

15. **Object Ownership:** ACLs disabled (recommended).
16. **Block Public Access settings for this bucket:** leave **Block all public access** ticked.
17. **Bucket Versioning:** Disable.
18. **Default encryption:** Server-side encryption with Amazon S3 managed keys (SSE-S3), Bucket Key **Enable**.
19. Click **Create bucket**.

**Lifecycle rule: this is what keeps 14 days.** S3 deletes old dumps by itself, so the server never needs permission to delete anything.

20. Click your new bucket → **Management** tab → **Create lifecycle rule**.
21. Lifecycle rule name `expire-backups-14-days`.
22. Rule scope: **Limit the scope of this rule using one or more filters**. Prefix: `postgres/`
23. Under **Lifecycle rule actions**, tick **Expire current versions of objects** and **Delete expired object delete markers or incomplete multipart uploads**.
24. **Expire current versions of objects:** Days after object creation `14`.
25. Under the delete-markers section, tick **Delete incomplete multipart uploads** and set Number of days `1`. (The "Delete expired object delete markers" box will be greyed out. That's fine.)
26. Click **Create rule**.

### A6. IAM policy (least privilege)

The server gets an IAM **role**, not access keys. EC2 hands the server short-lived credentials that renew on their own, so there is no AWS key to store, leak, or rotate. That is why section 12 has no `AWS_ACCESS_KEY_ID`.

27. Search bar → **IAM** → left menu **Policies** → **Create policy**.
28. Click the **JSON** tab, delete what's there, and paste the policy below. **Replace `YOUR-BUCKET-NAME` in all three places** with the bucket name from step 14.

    ```json
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Sid": "WriteAndRestoreBackups",
          "Effect": "Allow",
          "Action": ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"],
          "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/postgres/*"
        },
        {
          "Sid": "ListBackups",
          "Effect": "Allow",
          "Action": "s3:ListBucket",
          "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME",
          "Condition": { "StringLike": { "s3:prefix": ["postgres/", "postgres/*"] } }
        }
      ]
    }
    ```

    What the server can do: upload dumps, download them (for a restore), and list them, all inside `postgres/` of this one bucket. It cannot delete backups, touch any other bucket, or reach any other AWS service. Even if someone broke into the server, they could not delete your existing backups.

29. Click **Next**. Policy name `scense-backup-s3`, description `Scense EC2: write and read Postgres backups only`. Click **Create policy**.

### A7. IAM role for the instance

30. IAM → left menu **Roles** → **Create role**.
31. Trusted entity type **AWS service**. Use case **EC2** (choose plain "EC2", not one of the sub-options). Click **Next**.
32. In the permissions search box type `scense-backup-s3`, tick it, click **Next**.
33. Role name `scense-ec2-backup`. Click **Create role**. The console also creates an "instance profile" with the same name. That's what you attach to the instance in step 41.

### A8. Launch the EC2 instance

34. Search bar → **EC2** → **Instances** → **Launch instances**.
35. **Name and tags:** Name `scense-prod`.
36. **Application and OS Images:** Quick Start → **Ubuntu** → **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type**, architecture **64-bit (x86)**. (t3 instances are x86, so the Arm image will not work.)
37. **Instance type:** `t3.small`.
38. **Key pair (login):** `ScenseKeyPair`.
39. **Network settings:** click **Edit**. VPC: default. Subnet: No preference. Auto-assign public IP: Enable. Firewall: **Select existing security group** → `scense-web-sg`.
40. **Configure storage:** `20` GiB, **gp3**. Click **Advanced** on the storage panel, expand the volume, and set **Encrypted** to **Encrypted** (KMS key: the default `aws/ebs`). Leave "Delete on termination" as Yes.
41. Expand **Advanced details** and set:
    - **IAM instance profile:** `scense-ec2-backup`
    - **Termination protection:** Enable
    - **Metadata accessible:** Enabled
    - **Metadata version:** V2 only (token required)
    - **Metadata response hop limit:** `2`. This matters: the backup job runs inside a Docker container, which sits one network hop further from the metadata service. With the default of 1, the container cannot get the role's credentials and every backup fails with "Unable to locate credentials".
    - **Credit specification:** Standard. (The default "Unlimited" bills extra if the CPU stays busy for long. Standard throttles instead. Fine for a portfolio site.)
    - Leave everything else as it is.
42. Check the **Summary** panel on the right, then click **Launch instance** → **View all instances**. Wait until **Instance state** shows Running and **Status check** shows 3/3 checks passed (a couple of minutes).

### A9. Elastic IP

43. EC2 → left menu **Network & Security** → **Elastic IPs** → **Allocate Elastic IP address**. Network border group `ca-central-1`, **Amazon's pool of IPv4 addresses**. Click **Allocate**.
44. With the new address selected, click **Actions** → **Associate Elastic IP address**. Resource type **Instance**, instance `scense-prod`, private IP: the only one in the list. Click **Associate**.

    💾 **SAVE:** the Elastic IP (for example `15.222.x.x`). It goes into DNS and the `EC2_HOST` secret. Below it is written `<EIP>`.

    The temporary public IP the instance launched with is gone now. Always use the Elastic IP.

---

## Part B: Server setup over SSH

45. **PowerShell:** connect for the first time:

    ```powershell
    ssh -i "$HOME\.ssh\ScenseKeyPair.pem" ubuntu@<EIP>
    ```

    Type `yes` when asked about the host fingerprint. You should get an `ubuntu@ip-...:~$` prompt.

46. **Server:** confirm password login is off. The output must be `passwordauthentication no`:

    ```bash
    sudo sshd -T | grep -i '^passwordauthentication'
    ```

47. **Server:** apply updates, then reboot:

    ```bash
    sudo apt update && sudo apt -y upgrade
    sudo reboot
    ```

    Wait about 30 seconds, then reconnect with the command from step 45.

48. **Server:** install Docker Engine and the Compose plugin from Docker's own repository (Ubuntu's `docker.io` package lags behind and has no `docker compose`):

    ```bash
    sudo apt install -y ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo usermod -aG docker ubuntu
    exit
    ```

49. **PowerShell:** reconnect (step 45) so the `docker` group applies, then on the **server**:

    ```bash
    docker run --rm hello-world
    docker compose version
    ```

    You should see "Hello from Docker!" and a Compose version of v2 or later.

50. **Server:** add a 2 GB swap file. t3.small has 2 GB of RAM, and Postgres, Node, and Caddy together can spike past that during a deploy:

    ```bash
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    free -h
    ```

    `free -h` should show `Swap: 2.0Gi`.

51. **Server:** create the app folder the deploy will use:

    ```bash
    sudo mkdir -p /opt/scense
    sudo chown ubuntu:ubuntu /opt/scense
    ```

52. **Server:** check the instance has its role (output should include `"InstanceProfileArn"` ending in `scense-ec2-backup`):

    ```bash
    TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
    curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/info
    ```

53. **Server:** prove the backup permissions work **from inside a container** (this also tests the hop limit from step 41). Replace `YOUR-BUCKET-NAME`:

    ```bash
    B=YOUR-BUCKET-NAME
    echo test > /tmp/test.txt
    docker run --rm -e AWS_DEFAULT_REGION=ca-central-1 -v /tmp:/tmp amazon/aws-cli s3 cp /tmp/test.txt s3://$B/postgres/runbook-test.txt
    docker run --rm -e AWS_DEFAULT_REGION=ca-central-1 amazon/aws-cli s3 ls s3://$B/postgres/
    ```

    The first command prints `upload: ...` and the second lists `runbook-test.txt`.

54. **Server:** prove least privilege. Both of these **must fail** with `AccessDenied`:

    ```bash
    docker run --rm -e AWS_DEFAULT_REGION=ca-central-1 amazon/aws-cli s3 rm s3://$B/postgres/runbook-test.txt
    docker run --rm -e AWS_DEFAULT_REGION=ca-central-1 amazon/aws-cli s3 ls
    ```

    Leave the test file. The lifecycle rule deletes it in 14 days, which also proves the rule works.

    If step 53 says "Unable to locate credentials", the hop limit is still 1: EC2 → Instances → select `scense-prod` → **Actions** → **Instance settings** → **Modify instance metadata options** → hop limit `2` → **Save**.

### B2. Deploy key for GitHub Actions

GitHub gets its **own** key, separate from your admin key. If it ever leaks, you delete one line on the server and your own access is untouched.

55. **PowerShell** (a new window on your laptop, not the SSH session). When asked for a passphrase, press **Enter twice** to leave it empty (GitHub Actions cannot type one):

    ```powershell
    ssh-keygen -t ed25519 -C "github-actions-deploy@scense" -f "$HOME\.ssh\scense_deploy"
    ```

    This creates `scense_deploy` (🔒 **SECRET**, the private key) and `scense_deploy.pub` (public, safe to share).

56. **PowerShell:** add the public key to the server:

    ```powershell
    Get-Content "$HOME\.ssh\scense_deploy.pub" | ssh -i "$HOME\.ssh\ScenseKeyPair.pem" ubuntu@<EIP> "cat >> ~/.ssh/authorized_keys"
    ```

57. **PowerShell:** test that the deploy key logs in and can use Docker. It should print an empty container table:

    ```powershell
    ssh -i "$HOME\.ssh\scense_deploy" ubuntu@<EIP> "docker ps"
    ```

---

## Part C: DNS at your registrar

58. Sign in to the registrar where you bought `scense.name` and open the domain's DNS settings. The name varies: **Manage DNS**, **Advanced DNS**, **DNS Records**, or **Nameservers / DNS**.
59. Delete any existing **A**, **AAAA**, **CNAME**, or **URL redirect / forwarding** records for `@` (the bare domain) and `www`. Registrars often add "parking page" records that would fight with yours. Leave MX and TXT records alone.
60. Add two records:

    | Type | Host / Name | Value / Points to | TTL |
    |---|---|---|---|
    | A | `@` | `<EIP>` | 300 (5 min) |
    | A | `www` | `<EIP>` | 300 (5 min) |

    Some registrars want the full name (`scense.name`, `www.scense.name`) instead of `@` and `www`. If your DNS is on Cloudflare, set both records to **DNS only** (grey cloud), not Proxied, so Caddy can get its own certificate.

61. (Optional, recommended) Add a CAA record so only Let's Encrypt can issue certificates for the domain: Type **CAA**, Host `@`, Flags `0`, Tag `issue`, Value `letsencrypt.org`.
62. Save the records.
63. **PowerShell:** check that both names resolve to the Elastic IP. It can take from a few minutes to an hour:

    ```powershell
    Resolve-DnsName scense.name -Type A -Server 1.1.1.1
    Resolve-DnsName www.scense.name -Type A -Server 1.1.1.1
    ```

    Both must show `<EIP>` before the first deploy. Caddy asks Let's Encrypt for certificates on its first start. If DNS isn't ready, those requests fail, and Let's Encrypt limits how many failures it accepts per hour.

---

## Part D: Anthropic API key

Pass 1 doesn't call the AI, but section 12 lists the key, so set it now and it's ready for M9.

64. Go to **console.anthropic.com** → **Settings** → **API keys** → **Create Key**. Name `scense-prod`. Click **Add** / **Create**.
65. Click **Copy**. The key is shown only once. Go straight to step 74 and paste it into GitHub. 🔒 **SECRET.** Don't save it anywhere else. If you lose it, delete it and create a new one.
66. (Recommended) **Settings** → **Limits**: set a monthly spend limit, for example US$10.

---

## Part E: GitHub secrets

### E1. Generate the random secrets

Each command below generates 64 random hex characters straight onto your clipboard, so the value never shows on screen. Hex only, so it is safe inside the `DATABASE_URL`.

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower() | Set-Clipboard
```

67. Run the command, paste into a new password-manager entry named **Scense POSTGRES_PASSWORD**. 🔒 **SECRET.**
68. Run it again, paste into **Scense JWT_SECRET**. 🔒 **SECRET.**
69. Run it again, paste into **Scense ADMIN_TOKEN**. 🔒 **SECRET.** You will need this one later to call `/api/admin/usage`.

> **Don't change `POSTGRES_PASSWORD` after the first deploy.** Postgres reads it only when it creates the database volume. Changing the secret later locks the API out unless you also change the password inside Postgres.

### E2. Add the secrets

70. Open the repo on GitHub → **Settings** tab → left menu **Secrets and variables** → **Actions** → **Secrets** tab → under **Repository secrets** click **New repository secret**.
71. For each row below: type the **Name** exactly, paste or type the **Secret**, click **Add secret**, then click **New repository secret** again for the next one.

| # | Name | Value | Where it comes from |
|---|---|---|---|
| 72 | `POSTGRES_PASSWORD` | 🔒 the password | copy from password manager (step 67) |
| 73 | `DATABASE_URL` | 🔒 `postgres://scense:PASSWORD@db:5432/scense` | type `postgres://scense:` into the box, paste the password, type `@db:5432/scense`. `db` is the Compose service name, not a hostname you set up |
| 74 | `ANTHROPIC_API_KEY` | 🔒 the key | step 65 |
| 75 | `JWT_SECRET` | 🔒 the secret | password manager (step 68) |
| 76 | `ADMIN_TOKEN` | 🔒 the token | password manager (step 69) |
| 77 | `CORS_ORIGIN` | `https://scense.name` | exactly this, no trailing slash |
| 78 | `GUEST_DAILY_CONVERSATION_CAP` | `100` | spec default |
| 79 | `EC2_HOST` | `<EIP>` | step 44. The IP, not the domain, so a DNS problem can't break deploys |
| 80 | `EC2_USER` | `ubuntu` | default user on Ubuntu AMIs |
| 81 | `EC2_SSH_KEY` | 🔒 the deploy private key | run `Get-Content "$HOME\.ssh\scense_deploy" -Raw \| Set-Clipboard` in PowerShell, then paste. It must include the `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END ...-----` lines. Use `scense_deploy`, **not** the `.pub` file and **not** `ScenseKeyPair.pem` |
| 82 | `AWS_BACKUP_BUCKET` | the bucket name | step 14. The name only, no `s3://` |

83. Check the Repository secrets list shows exactly these 11 names, spelled exactly as above (GitHub shows names only, never values).
84. **PowerShell:** clear the clipboard. If Windows clipboard history is on (Win+V), delete those entries too:

    ```powershell
    Set-Clipboard -Value " "
    ```

---

## Part F: Final checks, then tell Claude

85. Run through this list:
    - [ ] `ssh -i "$HOME\.ssh\ScenseKeyPair.pem" ubuntu@<EIP>` works (admin key)
    - [ ] `ssh -i "$HOME\.ssh\scense_deploy" ubuntu@<EIP> "docker ps"` works (deploy key)
    - [ ] `docker compose version` on the server shows v2 or later
    - [ ] `/opt/scense` exists and is owned by `ubuntu`
    - [ ] Steps 53 and 54 behaved as described (upload works, delete is denied)
    - [ ] `Resolve-DnsName` shows the Elastic IP for both `scense.name` and `www.scense.name`
    - [ ] 11 repository secrets exist in GitHub
    - [ ] Termination protection is on (EC2 → instance → Details: "Termination protection: Enabled")

86. Tell Claude: **"The server is ready."** Don't include any secret values. Claude needs none of them to write M6.

---

## Part G: After the first deploy

The first push to `main` with M6 runs CI, builds and pushes the three images, and deploys. These steps happen once, after that first deploy succeeds.

87. GitHub → **Actions** tab → **Deploy** → open the newest run. All three jobs (ci, build, deploy) should be green, and the last step should print `HTTP 200`. Open `https://scense.name`: the page loads with a padlock, but the lists are empty until step 88.
88. **PowerShell**, in the repo root, with the local dev stack running (`docker compose up`) and the pipeline already loaded locally: copy the catalogue to production:

    ```powershell
    ./scripts/seed-prod.ps1
    ```

    It first checks that production's fragrance ids match your local database, then ends with `Production now has 1000 fragrances (1000,1498500 = fragrances,pair_scores).` At 1,000 fragrances the upload is about 14 MB and the load locks the catalogue tables for roughly 1 to 3 minutes (an estimate), so run it when the site is quiet; see DECISIONS.md B29. You can rerun it after every `pipeline` or `tune` run. Pass 2 changes that; see DECISIONS.md B22.

89. Check `https://www.scense.name` redirects to `https://scense.name`, and that `https://scense.name/f/creed-aventus-2010` loads.
90. **Server** (`ssh -i "$HOME\.ssh\ScenseKeyPair.pem" ubuntu@3.97.35.62`): run one backup now instead of waiting for 3 a.m.:

    ```bash
    cd /opt/scense
    docker compose -f docker-compose.prod.yml exec backup backup.sh
    docker compose -f docker-compose.prod.yml exec backup restore.sh
    ```

    The first command prints `backup: uploaded postgres/scense-<time>.dump`. The second lists the dumps in the bucket without restoring anything.

91. The next morning, check the nightly run: `docker compose -f docker-compose.prod.yml logs backup` should show a second `backup: uploaded` line, timed just after 3 a.m. Toronto time.

**Restoring a backup** (only when you need it): `restore.sh <file name>` replaces the live database with that dump, in one transaction, so a failed restore changes nothing.

---

## Choices this runbook makes

All of these are recorded in DECISIONS.md B22.

- **IAM role, not access keys,** for S3 backups. No AWS credentials exist to leak.
- **Retention is an S3 lifecycle rule,** not a cleanup script. The server cannot delete backups.
- **SSH port 22 open to anywhere, key-only.** GitHub-hosted runners have no fixed IPs. Revisit if the logs show trouble (fail2ban, or a self-hosted runner).
- **Separate deploy key** from the admin key, so either can be revoked alone.
- **GitHub secrets are the single source of truth.** The deploy job writes `/opt/scense/.env` from them on every deploy (mode 600), so you never edit a `.env` on the server by hand.
- **Metadata hop limit 2** so the backup container can use the instance role.
- **Ubuntu 24.04 LTS, Standard CPU credits, encrypted 20 GB gp3 root volume, termination protection on.**
