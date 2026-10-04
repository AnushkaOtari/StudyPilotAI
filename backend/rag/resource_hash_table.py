import time
import logging
from typing import Any, List, Tuple, Optional, Dict

logger = logging.getLogger(__name__)


class ResourceHashTable:


    def __init__(self, initial_capacity: int = 32):
        self.capacity: int = initial_capacity
        self._size: int = 0
        # Initialize array of empty buckets
        self.buckets: List[List[Tuple[str, Any]]] = [[] for _ in range(self.capacity)]

    def _hash(self, key: str) -> int:
        """
        Custom polynomial rolling hash function to convert a string key 
        into a bucket index within range [0, capacity - 1].
        """
        hash_val = 0
        p = 31
        for char in str(key):
            hash_val = (hash_val * p + ord(char)) % self.capacity
        return hash_val

    def _resize(self) -> None:
        """
        Doubles the hash table capacity and rehashes all existing key-value 
        pairs to maintain average O(1) complexity.
        """
        old_buckets = self.buckets
        self.capacity *= 2
        self._size = 0
        self.buckets = [[] for _ in range(self.capacity)]

        for bucket in old_buckets:
            for k, v in bucket:
                self.insert(k, v)

    def insert(self, key: str, value: Any) -> None:
        """
        Inserts or updates a key-value pair in the Hash Table.
        Average Complexity: O(1)
        """
        # Check load factor and resize if load factor > 0.75
        if (self._size + 1) / self.capacity > 0.75:
            self._resize()

        idx = self._hash(key)
        bucket = self.buckets[idx]

        # Update existing key if found
        for i, (k, v) in enumerate(bucket):
            if k == key:
                bucket[i] = (key, value)
                return

        # Key not found: insert new pair
        bucket.append((key, value))
        self._size += 1

    def get(self, key: str) -> Optional[Any]:
        """
        Retrieves the value associated with key.
        Returns None if key is not found.
        Average Complexity: O(1)
        """
        idx = self._hash(key)
        bucket = self.buckets[idx]
        for k, v in bucket:
            if k == key:
                return v
        return None

    def delete(self, key: str) -> bool:
        """
        Removes a key-value pair from the Hash Table by key.
        Returns True if deleted, False if key was not found.
        Average Complexity: O(1)
        """
        idx = self._hash(key)
        bucket = self.buckets[idx]
        for i, (k, v) in enumerate(bucket):
            if k == key:
                del bucket[i]
                self._size -= 1
                return True
        return False

    def contains(self, key: str) -> bool:
        """
        Checks if key exists in the Hash Table.
        Average Complexity: O(1)
        """
        return self.get(key) is not None

    def size(self) -> int:
        """
        Returns the total number of items stored in the Hash Table.
        Complexity: O(1)
        """
        return self._size

    def to_dict(self) -> Dict[str, Any]:
        """
        Export all indexed resource metadata entries.
        """
        result = {}
        for bucket in self.buckets:
            for k, v in bucket:
                result[k] = v
        return result


# Global singleton instance for application-level resource indexing
global_resource_hash_table = ResourceHashTable()
