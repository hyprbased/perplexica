import subprocess
import os

def get_file_tree(start_path='.'):
    tree = []
    for root, dirs, files in os.walk(start_path):
        relative_root = os.path.relpath(root, start_path)
        if relative_root == '.':
            relative_root = ''
        for d in dirs:
            tree.append(os.path.join(relative_root, d) + '/')
        for f in files:
            tree.append(os.path.join(relative_root, f))
    return '\n'.join(tree)

# Get the name of this script
current_script = os.path.basename(__file__)

# Define the file types to include
file_types = ["*.ts", "*.tsx", "*.js", "*.json", "*.yml", "*.toml", "*.md", "*.css"]

# Open the output file
with open("repo_contents.txt", "w", encoding='utf-8') as outfile:
    # Write the file tree first
    outfile.write("=== FILE TREE ===\n")
    outfile.write(get_file_tree() + "\n\n")
    
    # Loop through each file type
    for file_type in file_types:
        result = subprocess.run(["git", "ls-files", file_type], capture_output=True, text=True)
        files = result.stdout.splitlines()
        
        for file in files:
            if file != current_script:
                print(f"Processing: {file}")
                outfile.write(f"=== {file} ===\n")
                try:
                    with open(file, "r", encoding='utf-8') as f:
                        outfile.write(f.read() + "\n\n")
                except Exception as e:
                    print(f"Error processing {file}: {e}")
